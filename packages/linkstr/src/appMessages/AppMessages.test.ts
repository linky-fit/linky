import { Effect, Either, Exit, Layer, Option, Schema } from "effect";
import { ClientId, RelayUrl, RumorId, UnixSeconds } from "../domain/primitives";
import { decodeWrapEvent } from "../inbox/decodeWrapEvent";
import {
  hasPushMarker,
  makeIdentity,
  recipientOf,
  stubWrapTransport,
} from "../testing";
import type { SignedWrapEvent } from "../testing";
import { unwrapToRumor } from "../internal/giftWrap";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { AppMessages, appMessageChannel } from "./AppMessages";
import { AppMessageDraft, AppNamespace } from "./domain";
import { AppMessageReceived } from "./events";

const alice = makeIdentity();
const bob = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");
const app = AppNamespace.make("platitprosim");
const clientId = ClientId.make("record-1");

const PaymentRecord = Schema.Struct({
  v: Schema.Literal(1),
  type: Schema.Literal("PaymentRecord"),
  paymentId: Schema.String,
  amountCzk: Schema.Int,
});
const channel = appMessageChannel(app, PaymentRecord);

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, AppMessages>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        AppMessages.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              LinkstrIdentity.fromSecretKey(alice.secretKey),
              RelayPolicy.fixed({ readRelays: [relay], writeRelays: [relay] }),
              transport,
            ),
          ),
        ),
      ),
    ),
  );

const record = {
  v: 1,
  type: "PaymentRecord",
  paymentId: "pay-1",
  amountCzk: 12_300,
} as const;

describe("AppMessages.send", () => {
  it("wraps the channel's JSON once, to the recipient only, and the recipient decodes it typed", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.flatMap(AppMessages, (messages) =>
        messages.send(channel.draft(bob.pubkey, record, { clientId })),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(1);
    const wrap = published[0];
    assert(wrap !== undefined);
    expect(recipientOf(wrap)).toBe(bob.pubkey);
    expect(hasPushMarker(wrap)).toBe(false);

    const rumor = Either.getOrThrow(unwrapToRumor(wrap, bob.secretKey));
    expect(rumor.id).toBe(exit.value.rumorId);
    expect(rumor.kind).toBe(24137);
    expect(rumor.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["linky", "app_message"],
      ["app", "platitprosim"],
    ]);

    const { event } = decodeWrapEvent(wrap, bob);
    assert(event instanceof AppMessageReceived);
    expect(event).toMatchObject({ from: alice.pubkey, app, clientId });
    expect(channel.decode(event)).toEqual(Option.some(record));
  });

  it("fails WrapNotDelivered when no relay accepts the wrap", async () => {
    const exit = await runWith(
      stubWrapTransport([], () => false),
      Effect.flatMap(AppMessages, (messages) =>
        messages.send(channel.draft(bob.pubkey, record)),
      ),
    );
    assert(Exit.isFailure(exit));
    expect(JSON.stringify(exit.cause)).toContain("WrapNotDelivered");
  });
});

describe("appMessageChannel.decode", () => {
  const received = (overrides: Partial<AppMessageReceived>) =>
    new AppMessageReceived({
      messageId: RumorId.make("ab".repeat(32)),
      from: alice.pubkey,
      app,
      content: JSON.stringify(record),
      clientId: null,
      sentAt: UnixSeconds.make(1_700_000_000),
      ...overrides,
    });

  it("ignores another app's messages and content its schema rejects", () => {
    expect(
      channel.decode(received({ app: AppNamespace.make("other") })),
    ).toEqual(Option.none());
    expect(channel.decode(received({ content: '{"v":2}' }))).toEqual(
      Option.none(),
    );
    expect(channel.decode(received({ content: "not json" }))).toEqual(
      Option.none(),
    );
  });

  it("builds plain drafts any sender can deliver", () => {
    expect(channel.draft(bob.pubkey, record)).toEqual(
      new AppMessageDraft({
        to: bob.pubkey,
        app,
        content: JSON.stringify(record),
      }),
    );
  });
});
