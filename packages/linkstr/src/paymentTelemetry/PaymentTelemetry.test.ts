import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl, UnixSeconds } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { hasPushMarker, makeIdentity, stubWrapTransport } from "../testing";
import { PaymentTelemetryDraft } from "./domain";
import { PaymentTelemetry } from "./PaymentTelemetry";

const identity = makeIdentity();
const collector = makeIdentity();
const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const makeDraft = (id: string): PaymentTelemetryDraft =>
  new PaymentTelemetryDraft({
    id: ClientId.make(id),
    createdAtSec: UnixSeconds.make(1_754_000_000),
    direction: "in",
    status: "ok",
    method: "cashu_receive",
    phase: "receive",
    mint: null,
    amountBucket: "lte_100",
    feeBucket: null,
    errorCode: null,
    errorDetail: null,
    appHost: null,
    devicePlatform: "iphone",
    appRuntime: "web",
    appVersion: "26.9.0",
  });

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, PaymentTelemetry>,
): Promise<Exit.Exit<A, E>> => {
  const dependencies = Layer.mergeAll(
    LinkstrIdentity.fromSecretKey(identity.secretKey),
    RelayPolicy.fixed({
      readRelays: [relayA, relayB],
      writeRelays: [relayA, relayB],
    }),
    transport,
  );
  return Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        PaymentTelemetry.Default.pipe(Layer.provide(dependencies)),
      ),
    ),
  );
};

describe("PaymentTelemetry.publishPaymentTelemetry", () => {
  it("uses a fresh anonymous author and an unmarked wrap for every publish", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const paymentTelemetry = yield* PaymentTelemetry;
        return yield* Effect.all([
          paymentTelemetry.publishPaymentTelemetry(
            makeDraft("telemetry-1"),
            collector.pubkey,
          ),
          paymentTelemetry.publishPaymentTelemetry(
            makeDraft("telemetry-2"),
            collector.pubkey,
          ),
        ]);
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(2);
    const firstWrap = published[0];
    const secondWrap = published[1];
    assert(firstWrap !== undefined && secondWrap !== undefined);

    expect(firstWrap.pubkey).not.toBe(secondWrap.pubkey);
    expect(firstWrap.pubkey).not.toBe(identity.pubkey);
    expect(secondWrap.pubkey).not.toBe(identity.pubkey);
    expect(hasPushMarker(firstWrap)).toBe(false);
    expect(hasPushMarker(secondWrap)).toBe(false);

    const firstRumor = Either.getOrThrow(
      unwrapToRumor(firstWrap, collector.secretKey),
    );
    const secondRumor = Either.getOrThrow(
      unwrapToRumor(secondWrap, collector.secretKey),
    );
    expect(firstRumor.pubkey).not.toBe(secondRumor.pubkey);
    expect(firstRumor.pubkey).not.toBe(identity.pubkey);
    expect(secondRumor.pubkey).not.toBe(identity.pubkey);
    expect(firstRumor.tags).toEqual([
      ["p", collector.pubkey],
      ["client", "telemetry-1"],
      ["linky", "payment_telemetry"],
    ]);
  });

  it("succeeds when at least one write relay accepts the wrap", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published, (_wrap, relay) => relay === relayB),
      Effect.gen(function* () {
        const paymentTelemetry = yield* PaymentTelemetry;
        return yield* paymentTelemetry.publishPaymentTelemetry(
          makeDraft("telemetry-success"),
          collector.pubkey,
        );
      }),
    );

    expect(exit).toEqual(
      Exit.succeed(
        expect.objectContaining({
          clientId: "telemetry-success",
          recipientCopy: expect.objectContaining({ acceptedBy: [relayB] }),
        }),
      ),
    );
    expect(published).toHaveLength(1);
  });

  it("fails when every write relay rejects the wrap", async () => {
    const exit = await runWith(
      stubWrapTransport([], () => false),
      Effect.gen(function* () {
        const paymentTelemetry = yield* PaymentTelemetry;
        return yield* paymentTelemetry.publishPaymentTelemetry(
          makeDraft("telemetry-failure"),
          collector.pubkey,
        );
      }),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "WrapNotDelivered",
          clientId: "telemetry-failure",
          recipientCopy: expect.objectContaining({
            acceptedBy: [],
            rejectedBy: [
              expect.objectContaining({ relay: relayA, detail: "blocked" }),
              expect.objectContaining({ relay: relayB, detail: "blocked" }),
            ],
          }),
        }),
      ),
    );
  });
});
