import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl } from "../domain/primitives";
import {
  LINKY_PUSH_MARKER_TAG,
  LINKY_PUSH_MARKER_VALUE,
  unwrapToRumor,
} from "../internal/giftWrap";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, recipientOf, stubWrapTransport } from "../testing";
import { PaymentNoticeDraft } from "./domain";
import { PaymentNotices } from "./PaymentNotices";

const alice = makeIdentity();
const bob = makeIdentity();
const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");
const clientId = ClientId.make("client-42");

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, PaymentNotices>,
): Promise<Exit.Exit<A, E>> => {
  const dependencies = Layer.mergeAll(
    LinkstrIdentity.fromSecretKey(alice.secretKey),
    RelayPolicy.fixed({
      readRelays: [relayA, relayB],
      writeRelays: [relayA, relayB],
    }),
    transport,
  );
  return Effect.runPromiseExit(
    program.pipe(
      Effect.provide(PaymentNotices.Default.pipe(Layer.provide(dependencies))),
    ),
  );
};

describe("PaymentNotices.send", () => {
  it("publishes one push-marked recipient wrap and returns its receipt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const paymentNotices = yield* PaymentNotices;
        return yield* paymentNotices.send(
          new PaymentNoticeDraft({
            to: bob.pubkey,
            context: "bank_payment_offer",
            offerId: "offer-1",
            clientId,
          }),
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(1);
    const wrap = published[0];
    assert(wrap !== undefined);
    expect(recipientOf(wrap)).toBe(bob.pubkey);
    expect(wrap.tags).toContainEqual([
      LINKY_PUSH_MARKER_TAG,
      LINKY_PUSH_MARKER_VALUE,
    ]);
    expect(wrap.created_at).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000));

    const rumor = Either.getOrThrow(unwrapToRumor(wrap, bob.secretKey));
    expect(rumor.kind).toBe(24133);
    expect(rumor.content).toBe("payment_notice");
    expect(rumor.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["linky", "payment_notice"],
      ["context", "bank_payment_offer"],
      ["offer", "offer-1"],
    ]);
    expect(exit.value.rumorId).toBe(rumor.id);
    expect(exit.value.clientId).toBe(clientId);
    expect(exit.value.recipientCopy.wrapId).toBe(wrap.id);
    expect(exit.value.recipientCopy.acceptedBy).toEqual([relayA, relayB]);
  });

  it("fails with WrapNotDelivered when every relay rejects", async () => {
    const exit = await runWith(
      stubWrapTransport([], () => false),
      Effect.gen(function* () {
        const paymentNotices = yield* PaymentNotices;
        return yield* paymentNotices.send(
          new PaymentNoticeDraft({ to: bob.pubkey, clientId }),
        );
      }),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "WrapNotDelivered",
          clientId,
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
