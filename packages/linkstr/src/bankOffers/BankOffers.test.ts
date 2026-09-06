import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  hasPushMarker,
  makeIdentity,
  recipientOf,
  stubWrapTransport,
} from "../testing";
import { BankOffers } from "./BankOffers";
import { BankOfferDraft, BankOfferId } from "./domain";
import type { BankOfferStatus } from "./domain";

const alice = makeIdentity();
const bob = makeIdentity();
const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");
const clientId = ClientId.make("client-42");
const offerId = BankOfferId.make("offer-1");

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, BankOffers>,
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
      Effect.provide(BankOffers.Default.pipe(Layer.provide(dependencies))),
    ),
  );
};

const makeDraft = (
  status: BankOfferStatus,
  pushMark?: boolean,
): BankOfferDraft =>
  new BankOfferDraft({
    to: bob.pubkey,
    offerId,
    offerer: alice.pubkey,
    status,
    amountText: "1 000 Kč",
    text: "verbatim text",
    clientId,
    ...(pushMark === undefined ? {} : { pushMark }),
  });

describe("BankOffers.send", () => {
  it("publishes recipient-first and returns the snapshot receipt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const bankOffers = yield* BankOffers;
        return yield* bankOffers.send(makeDraft("offered"));
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(published.map(recipientOf)).toEqual([bob.pubkey, alice.pubkey]);
    expect(exit.value).toEqual(
      expect.objectContaining({
        offerId,
        status: "offered",
        clientId,
        selfCopy: expect.objectContaining({ acceptedBy: [relayA, relayB] }),
        recipientCopy: expect.objectContaining({
          acceptedBy: [relayA, relayB],
        }),
      }),
    );
    const recipientWrap = published[0];
    assert(recipientWrap !== undefined);
    const rumor = Either.getOrThrow(
      unwrapToRumor(recipientWrap, bob.secretKey),
    );
    expect(exit.value.rumorId).toBe(rumor.id);
    expect(exit.value.content).toBe(rumor.content);
    expect(rumor.kind).toBe(24135);
    expect(JSON.parse(rumor.content)).toEqual(
      expect.objectContaining({
        statusUpdatedAtSec: exit.value.sentAt,
        initiatedAtSec: exit.value.sentAt,
      }),
    );
  });

  it.each([
    { status: "offered" as const, expected: true },
    { status: "accepted" as const, expected: true },
    { status: "accepted_by_other" as const, expected: true },
    { status: "bank_details_sent" as const, expected: true },
    { status: "bank_paid" as const, expected: true },
    { status: "declined" as const, expected: true },
    { status: "canceled" as const, expected: false },
    { status: "settled" as const, expected: false },
  ])("sets the $status push default", async ({ status, expected }) => {
    const published: Array<SignedWrapEvent> = [];
    await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const bankOffers = yield* BankOffers;
        return yield* bankOffers.send(makeDraft(status));
      }),
    );

    expect(
      published[0] === undefined ? undefined : hasPushMarker(published[0]),
    ).toBe(expected);
    expect(
      published[1] === undefined ? undefined : hasPushMarker(published[1]),
    ).toBe(false);
  });

  it.each([
    { status: "offered" as const, pushMark: false, expected: false },
    { status: "settled" as const, pushMark: true, expected: true },
  ])(
    "honors pushMark=$pushMark over the $status default",
    async ({ status, pushMark, expected }) => {
      const published: Array<SignedWrapEvent> = [];
      await runWith(
        stubWrapTransport(published),
        Effect.gen(function* () {
          const bankOffers = yield* BankOffers;
          return yield* bankOffers.send(makeDraft(status, pushMark));
        }),
      );

      expect(
        published[0] === undefined ? undefined : hasPushMarker(published[0]),
      ).toBe(expected);
    },
  );

  it("does not publish the self copy when the recipient is rejected", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published, () => false),
      Effect.gen(function* () {
        const bankOffers = yield* BankOffers;
        return yield* bankOffers.send(makeDraft("accepted"));
      }),
    );

    expect(published.map(recipientOf)).toEqual([bob.pubkey]);
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "NoRelayReachable",
          clientId,
          selfCopy: expect.objectContaining({
            acceptedBy: [],
            rejectedBy: [],
          }),
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

  it("succeeds when the recipient lands and the best-effort self copy fails", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published, (wrap) => recipientOf(wrap) === bob.pubkey),
      Effect.gen(function* () {
        const bankOffers = yield* BankOffers;
        return yield* bankOffers.send(makeDraft("settled"));
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.recipientCopy.accepted).toBe(true);
    expect(exit.value.selfCopy.accepted).toBe(false);
  });
});
