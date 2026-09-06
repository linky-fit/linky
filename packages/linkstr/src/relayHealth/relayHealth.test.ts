import { Effect, Fiber, Layer, Stream } from "effect";
import type { Scope } from "effect";
import { generateSecretKey, getEventHash, getPublicKey } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import {
  NostrSecretKey,
  Pubkey,
  RelayUrl,
  UnixSeconds,
} from "../domain/primitives";
import { wrapRumorFor } from "../internal/giftWrap";
import { Rumor } from "../internal/nostrEvent";
import {
  NostrTransport,
  RelayPublishResult,
  RelayUnreachable,
} from "../services/NostrTransport";
import type {
  NostrTransportService,
  SubscribeOptions,
} from "../services/NostrTransport";
import { eventually } from "../testing";
import { RelayHealth } from "./RelayHealth";
import type { RelayHealthState } from "./RelayHealth";
import { observeTransport } from "./observeTransport";

const secretKey = NostrSecretKey.make(generateSecretKey());
const pubkey = Pubkey.make(getPublicKey(secretKey));

const rumorFields = {
  pubkey,
  created_at: UnixSeconds.make(1_754_000_000),
  kind: 7,
  tags: [["p", pubkey]],
  content: "👍",
};
const wrapEvent = wrapRumorFor(
  new Rumor({ ...rumorFields, id: getEventHash(rumorFields) }),
  secretKey,
  pubkey,
);

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const withObserved = <A, E>(
  transport: NostrTransportService,
  body: (
    stateOf: (relay: RelayUrl) => RelayHealthState | undefined,
  ) => Effect.Effect<A, E, NostrTransport | RelayHealth | Scope.Scope>,
): Promise<A> =>
  Effect.gen(function* () {
    const health = yield* RelayHealth;
    const stateOf = (relay: RelayUrl) =>
      Effect.runSync(health.current).get(relay);
    return yield* body(stateOf);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      observeTransport(Layer.succeed(NostrTransport, transport)).pipe(
        Layer.provideMerge(RelayHealth.live),
      ),
    ),
    Effect.runPromise,
  );

interface CapturedSubscription {
  readonly onEvent: (event: NostrToolsEvent) => void;
  readonly options: SubscribeOptions | undefined;
  readonly end: (reason: string) => void;
}

const subscribingTransport = (
  subscriptions: Array<CapturedSubscription>,
): NostrTransportService => ({
  publish: () => Effect.die("publish not under test"),
  subscribe: (_relay, _filter, onEvent, options) =>
    Effect.async<string, RelayUnreachable>((resume) => {
      subscriptions.push({
        onEvent,
        options,
        end: (reason) => resume(Effect.succeed(reason)),
      });
    }),
  fetch: () => Effect.die("fetch not under test"),
});

describe("observeTransport", () => {
  it("marks a relay connecting on subscribe and connected on EOSE", async () => {
    const subscriptions: Array<CapturedSubscription> = [];

    await withObserved(subscribingTransport(subscriptions), (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* Effect.forkScoped(
          transport.subscribe(relayA, { kinds: [1059] }, () => {}),
        );
        yield* eventually(() => subscriptions.length === 1);
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({ state: "connecting", lastSeenAt: null }),
        );

        subscriptions[0]?.options?.onEose?.();
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "connected",
            detail: null,
            lastSeenAt: expect.any(Number),
          }),
        );
      }),
    );
  });

  it("marks a relay connected on the first received event and delivers it", async () => {
    const subscriptions: Array<CapturedSubscription> = [];
    const received: Array<string> = [];

    await withObserved(subscribingTransport(subscriptions), (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* Effect.forkScoped(
          transport.subscribe(relayA, { kinds: [1059] }, (event) => {
            received.push(event.id);
          }),
        );
        yield* eventually(() => subscriptions.length === 1);

        subscriptions[0]?.onEvent(wrapEvent);
        expect(received).toEqual([wrapEvent.id]);
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "connected",
            lastSeenAt: expect.any(Number),
          }),
        );
      }),
    );
  });

  it("marks a relay unreachable when the subscription ends, then connecting again on resubscribe", async () => {
    const subscriptions: Array<CapturedSubscription> = [];

    await withObserved(subscribingTransport(subscriptions), (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        const subscribeOnce = transport.subscribe(
          relayA,
          { kinds: [1059] },
          () => {},
        );
        const fiber = yield* Effect.fork(subscribeOnce);
        yield* eventually(() => subscriptions.length === 1);
        subscriptions[0]?.options?.onEose?.();

        subscriptions[0]?.end("relay says bye");
        expect(yield* Fiber.join(fiber)).toBe("relay says bye");
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "unreachable",
            detail: "relay says bye",
            lastErrorAt: expect.any(Number),
          }),
        );

        yield* Effect.forkScoped(subscribeOnce);
        yield* eventually(() => subscriptions.length === 2);
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "connecting",
            detail: "relay says bye",
          }),
        );

        subscriptions[1]?.options?.onEose?.();
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({ state: "connected", detail: null }),
        );
      }),
    );
  });

  it("marks a relay unreachable with the failure detail when subscribing fails", async () => {
    const failingTransport: NostrTransportService = {
      publish: () => Effect.die("publish not under test"),
      subscribe: (relay) =>
        Effect.fail(new RelayUnreachable({ relay, detail: "refused" })),
      fetch: () => Effect.die("fetch not under test"),
    };

    await withObserved(failingTransport, (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* Effect.ignore(
          transport.subscribe(relayA, { kinds: [1059] }, () => {}),
        );
        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "unreachable",
            detail: "refused",
            lastErrorAt: expect.any(Number),
          }),
        );
      }),
    );
  });

  it("records publish outcomes; accepted promotes, rejected does not demote", async () => {
    const publishingTransport: NostrTransportService = {
      publish: (relays) =>
        Effect.succeed(
          relays.map(
            (relay) =>
              new RelayPublishResult({
                relay,
                accepted: relay === relayA,
                detail: relay === relayA ? "stored" : "blocked: spam",
              }),
          ),
        ),
      subscribe: () => Effect.die("subscribe not under test"),
      fetch: () => Effect.die("fetch not under test"),
    };

    await withObserved(publishingTransport, (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* transport.publish([relayA, relayB], wrapEvent);

        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "connected",
            lastSeenAt: expect.any(Number),
            lastPublish: expect.objectContaining({
              accepted: true,
              detail: "stored",
            }),
          }),
        );
        expect(stateOf(relayB)).toEqual(
          expect.objectContaining({
            state: "connecting",
            lastErrorAt: expect.any(Number),
            lastPublish: expect.objectContaining({
              accepted: false,
              detail: "blocked: spam",
            }),
          }),
        );
      }),
    );
  });

  it("folds fetch success into lastSeenAt and fetch failure into unreachable", async () => {
    const fetchingTransport: NostrTransportService = {
      publish: () => Effect.die("publish not under test"),
      subscribe: () => Effect.die("subscribe not under test"),
      fetch: (relay) =>
        relay === relayA
          ? Effect.succeed([])
          : Effect.fail(new RelayUnreachable({ relay, detail: "timeout" })),
    };

    await withObserved(fetchingTransport, (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* transport.fetch(relayA, { kinds: [0] });
        yield* Effect.ignore(transport.fetch(relayB, { kinds: [0] }));

        expect(stateOf(relayA)).toEqual(
          expect.objectContaining({
            state: "connected",
            lastSeenAt: expect.any(Number),
          }),
        );
        expect(stateOf(relayB)).toEqual(
          expect.objectContaining({ state: "unreachable", detail: "timeout" }),
        );
      }),
    );
  });

  it("streams snapshot changes to subscribers", async () => {
    const subscriptions: Array<CapturedSubscription> = [];

    await withObserved(subscribingTransport(subscriptions), () =>
      Effect.gen(function* () {
        const health = yield* RelayHealth;
        const seen: Array<RelayHealthState | undefined> = [];
        yield* Effect.forkScoped(
          Stream.runForEach(health.changes, (snapshot) =>
            Effect.sync(() => seen.push(snapshot.get(relayA))),
          ),
        );

        const transport = yield* NostrTransport;
        yield* Effect.forkScoped(
          transport.subscribe(relayA, { kinds: [1059] }, () => {}),
        );
        yield* eventually(() => subscriptions.length === 1);
        subscriptions[0]?.options?.onEose?.();

        yield* eventually(() =>
          seen.some((state) => state?.state === "connected"),
        );
      }),
    );
  });

  it("passes the caller's onEose through alongside the health fold", async () => {
    const subscriptions: Array<CapturedSubscription> = [];
    let callerEose = 0;

    await withObserved(subscribingTransport(subscriptions), (stateOf) =>
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* Effect.forkScoped(
          transport.subscribe(relayA, { kinds: [1059] }, () => {}, {
            onEose: () => {
              callerEose += 1;
            },
          }),
        );
        yield* eventually(() => subscriptions.length === 1);
        subscriptions[0]?.options?.onEose?.();
        expect(callerEose).toBe(1);
        expect(stateOf(relayA)?.state).toBe("connected");
      }),
    );
  });

  it("is a pass-through when no RelayHealth is provided", async () => {
    const subscriptions: Array<CapturedSubscription> = [];

    await Effect.gen(function* () {
      const transport = yield* NostrTransport;
      yield* Effect.forkScoped(
        transport.subscribe(relayA, { kinds: [1059] }, () => {}),
      );
      yield* eventually(() => subscriptions.length === 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        observeTransport(
          Layer.succeed(NostrTransport, subscribingTransport(subscriptions)),
        ),
      ),
      Effect.runPromise,
    );
  });
});
