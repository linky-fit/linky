import { Duration, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { authTemplate, createNonce } from "@linky-fit/linkauth";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { RelayUrl } from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import {
  NostrTransport,
  RelayPublishResult,
  RelayUnreachable,
} from "../services/NostrTransport";
import { makeIdentity } from "../testing";
import { NostrConnect } from "./NostrConnect";
import { NostrConnectRequest } from "./domain";

const me = makeIdentity();
const relays = [
  RelayUrl.make("wss://relay-a.test"),
  RelayUrl.make("wss://relay-b.test"),
] as const;
const START_MILLIS = 1_760_000_000_000;

const SignerReply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    result: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
);
type SignerReply = typeof SignerReply.Type;
const decodeReply = Schema.decodeUnknownSync(SignerReply);
const decodeSignedEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(SignedPlainEvent),
);

/** The website's side of the handshake, speaking through a fake transport. */
class FakeSite {
  readonly client = makeIdentity();
  readonly replies: Array<SignerReply> = [];
  readonly subscriptions: Array<{
    filter: Filter;
    closed: boolean;
    closeFromRelay: (reason: string) => void;
  }> = [];
  private readonly listeners: Array<(event: NostrToolsEvent) => void> = [];
  private readonly key = getConversationKey(this.client.secretKey, me.pubkey);

  private readonly onReply: (site: FakeSite, reply: SignerReply) => void;
  private readonly accept: boolean;
  private readonly unreachable: ReadonlyArray<RelayUrl>;

  constructor(
    onReply: (site: FakeSite, reply: SignerReply) => void,
    options: { accept?: boolean; unreachable?: ReadonlyArray<RelayUrl> } = {},
  ) {
    this.onReply = onReply;
    this.accept = options.accept ?? true;
    this.unreachable = options.unreachable ?? [];
  }

  readonly request = (fields: { perms?: Array<string> } = {}) =>
    new NostrConnectRequest({
      clientPubkey: this.client.pubkey,
      relays: [...relays],
      secret: "s3cret",
      perms: fields.perms ?? ["sign_event:24139"],
      name: "PEAU·RLA",
      url: "https://peaurla.test/login",
      image: null,
    });

  /** Every relay forwards the request, as real relays would. */
  readonly send = (rpc: {
    id: string;
    method: string;
    params: ReadonlyArray<string>;
  }) => {
    const event = finalizeEvent(
      {
        kind: 24133,
        tags: [["p", me.pubkey]],
        content: encrypt(JSON.stringify(rpc), this.key),
        created_at: Math.floor(START_MILLIS / 1000),
      },
      this.client.secretKey,
    );
    for (const listener of this.listeners) listener(event);
  };

  readonly layer = Layer.succeed(NostrTransport, {
    publish: (targets, event) =>
      Effect.sync(() => {
        expect(event.kind).toBe(24133);
        expect(event.pubkey).toBe(me.pubkey);
        expect(event.tags).toEqual([["p", this.client.pubkey]]);
        const reply = decodeReply(decrypt(event.content, this.key));
        this.replies.push(reply);
        this.onReply(this, reply);
        return targets.map(
          (relay) =>
            new RelayPublishResult({
              relay,
              accepted: this.accept,
              detail: null,
            }),
        );
      }),
    subscribe: (relay, filter, onEvent, options) =>
      this.unreachable.includes(relay)
        ? Effect.fail(new RelayUnreachable({ relay, detail: "503" }))
        : Effect.callback<string>((resume) => {
            const subscription = {
              filter,
              closed: false,
              closeFromRelay: (reason: string) => {
                subscription.closed = true;
                resume(Effect.succeed(reason));
              },
            };
            this.subscriptions.push(subscription);
            this.listeners.push((event) => {
              if (!subscription.closed) onEvent(event);
            });
            options?.onEose?.();
            return Effect.sync(() => {
              subscription.closed = true;
            });
          }),
    fetch: () => Effect.die("fetch not under test"),
  });
}

const loginTemplate = () =>
  JSON.stringify(
    authTemplate({ audience: "https://peaurla.test", nonce: createNonce() }),
  );

const noteTemplate = JSON.stringify({ kind: 1, content: "hi", tags: [] });

const isAck = (reply: SignerReply) => reply.result === "s3cret";

const forkLogin = (site: FakeSite, request = site.request()) =>
  Effect.flatMap(NostrConnect, (connect) => connect.login(request)).pipe(
    Effect.provide(
      NostrConnect.layer.pipe(
        Layer.provide(
          Layer.merge(LinkstrIdentity.fromSecretKey(me.secretKey), site.layer),
        ),
      ),
    ),
    Effect.forkChild,
  );

/** Lets the login fiber reach its timed wait for the next request before the clock moves. */
const untilWaiting = (site: FakeSite, replies: number) =>
  Effect.yieldNow.pipe(
    Effect.repeat({ until: () => site.replies.length === replies }),
  );

const runTest = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(START_MILLIS);
      return yield* program;
    }).pipe(Effect.provide(TestClock.layer())),
  );

describe("NostrConnect.login", () => {
  it("acks, signs the site's login and disconnects", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite((site, reply) => {
          if (isAck(reply)) {
            site.send({
              id: "sign-1",
              method: "sign_event",
              params: [loginTemplate()],
            });
          }
        });
        const exit = yield* Fiber.await(yield* forkLogin(site));

        expect(exit).toEqual(
          Exit.succeed(
            expect.objectContaining({
              clientPubkey: site.client.pubkey,
              signedKind: 24139,
            }),
          ),
        );
        // The request arrived from both relays and was answered once.
        expect(site.replies).toHaveLength(2);
        const signed = site.replies[1];
        expect(signed?.id).toBe("sign-1");
        const event = decodeSignedEvent(signed?.result);
        expect(verifyEvent(event)).toBe(true);
        expect(event).toMatchObject({
          pubkey: me.pubkey,
          kind: 24139,
          created_at: START_MILLIS / 1000,
        });
        expect(site.subscriptions).toHaveLength(2);
        expect(site.subscriptions[0]?.filter).toEqual({
          kinds: [24133],
          authors: [site.client.pubkey],
          "#p": [me.pubkey],
          since: START_MILLIS / 1000 - 60,
        });
        expect(site.subscriptions.every(({ closed }) => closed)).toBe(true);
      }),
    ));

  it("succeeds after an idle grace when the site only asks for the pubkey", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite((site, reply) => {
          if (isAck(reply)) {
            site.send({ id: "pk", method: "get_public_key", params: [] });
          }
        });
        const fiber = yield* forkLogin(site);
        yield* untilWaiting(site, 2);
        expect(site.replies[1]).toEqual({ id: "pk", result: me.pubkey });

        yield* TestClock.adjust(Duration.seconds(9));
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(Duration.seconds(1));
        expect(yield* Fiber.join(fiber)).toMatchObject({ signedKind: null });
        expect(site.subscriptions.every(({ closed }) => closed)).toBe(true);
      }),
    ));

  it("answers unsupported methods with an error and keeps waiting", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite((site, reply) => {
          if (isAck(reply)) {
            site.send({ id: "x", method: "switch_relays", params: [] });
          } else if (reply.id === "x") {
            site.send({
              id: "sign",
              method: "sign_event",
              params: [loginTemplate()],
            });
          }
        });
        const exit = yield* Fiber.await(yield* forkLogin(site));
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(site.replies[1]).toEqual({
          id: "x",
          error: "unsupported method switch_relays",
        });
      }),
    ));

  it("refuses a kind outside the login policy and fails", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite((site, reply) => {
          if (isAck(reply)) {
            site.send({
              id: "note",
              method: "sign_event",
              params: [noteTemplate],
            });
          }
        });
        const exit = yield* Fiber.await(
          yield* forkLogin(site, site.request({ perms: [] })),
        );
        expect(exit).toEqual(
          Exit.fail(
            expect.objectContaining({
              _tag: "NostrConnectRequestRefused",
              method: "sign_event",
              reason: "kind 1 is not allowed",
            }),
          ),
        );
        expect(site.replies[1]).toEqual({
          id: "note",
          error: "kind 1 is not allowed",
        });
        expect(site.subscriptions.every(({ closed }) => closed)).toBe(true);
      }),
    ));

  it("times out when the site never answers", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(() => {});
        const fiber = yield* forkLogin(site);
        yield* untilWaiting(site, 1);
        yield* TestClock.adjust(Duration.seconds(60));
        const exit = yield* Fiber.await(fiber);
        expect(exit).toEqual(
          Exit.fail(expect.objectContaining({ _tag: "NostrConnectTimedOut" })),
        );
        expect(site.subscriptions.every(({ closed }) => closed)).toBe(true);
      }),
    ));

  it("fails when no relay accepts the ack", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(() => {}, { accept: false });
        const exit = yield* Fiber.await(yield* forkLogin(site));
        expect(exit).toEqual(
          Exit.fail(
            expect.objectContaining({
              _tag: "NostrConnectAckNotDelivered",
              results: [
                expect.objectContaining({ accepted: false }),
                expect.objectContaining({ accepted: false }),
              ],
            }),
          ),
        );
      }),
    ));

  it("still logs in when only one relay is reachable", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(
          (site, reply) => {
            if (isAck(reply)) {
              site.send({
                id: "sign",
                method: "sign_event",
                params: [loginTemplate()],
              });
            }
          },
          { unreachable: [relays[0]] },
        );
        const exit = yield* Fiber.await(yield* forkLogin(site));
        expect(exit).toEqual(
          Exit.succeed(expect.objectContaining({ signedKind: 24139 })),
        );
      }),
    ));

  it("fails without publishing the ack when no relay subscription opens", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(() => {}, { unreachable: [...relays] });
        const exit = yield* Fiber.await(yield* forkLogin(site));
        expect(exit).toEqual(
          Exit.fail(
            expect.objectContaining({
              _tag: "NostrConnectRelaysUnreachable",
              failures: [
                expect.objectContaining({ relay: relays[0], detail: "503" }),
                expect.objectContaining({ relay: relays[1], detail: "503" }),
              ],
            }),
          ),
        );
        expect(site.replies).toEqual([]);
      }),
    ));

  it("fails promptly when every subscription ends mid-login", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(() => {});
        const fiber = yield* forkLogin(site);
        yield* untilWaiting(site, 1);
        for (const subscription of site.subscriptions) {
          subscription.closeFromRelay("error: shutting down");
        }
        const exit = yield* Fiber.await(fiber);
        expect(exit).toEqual(
          Exit.fail(
            expect.objectContaining({ _tag: "NostrConnectRelaysUnreachable" }),
          ),
        );
      }),
    ));

  it("closes every subscription when interrupted", () =>
    runTest(
      Effect.gen(function* () {
        const site = new FakeSite(() => {});
        const fiber = yield* forkLogin(site);
        yield* untilWaiting(site, 1);
        yield* Fiber.interrupt(fiber);
        expect(site.subscriptions).toHaveLength(2);
        expect(site.subscriptions.every(({ closed }) => closed)).toBe(true);
      }),
    ));
});
