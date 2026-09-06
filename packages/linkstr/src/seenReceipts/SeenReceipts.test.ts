import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl, UnixSeconds } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import { firstTagValue, tagValues } from "../internal/nostrEvent";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, recipientOf, stubWrapTransport } from "../testing";
import { SeenReceiptDraft } from "./domain";
import { SeenReceipts } from "./SeenReceipts";

const alice = makeIdentity();
const bob = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const draft = new SeenReceiptDraft({
  to: bob.pubkey,
  sinceSec: UnixSeconds.make(1_753_000_000),
  seenUpToSec: UnixSeconds.make(1_753_999_000),
  clientId: ClientId.make("client-42"),
});

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, SeenReceipts>,
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
      Effect.provide(SeenReceipts.Default.pipe(Layer.provide(dependencies))),
    ),
  );
};

describe("SeenReceipts.send", () => {
  it("publishes one wrap per copy and returns a full receipt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const receipts = yield* SeenReceipts;
        return yield* receipts.send(draft);
      }),
    );

    assert(Exit.isSuccess(exit));
    const receipt = exit.value;

    expect(receipt.clientId).toBe("client-42");
    expect(receipt.selfCopy.acceptedBy).toEqual([relayA, relayB]);
    expect(receipt.recipientCopy.acceptedBy).toEqual([relayA, relayB]);

    expect(published).toHaveLength(2);
    const recipients = published.map(recipientOf);
    expect(recipients).toContain(alice.pubkey);
    expect(recipients).toContain(bob.pubkey);

    // Both copies must decrypt to the same rumor: the receipt's rumorId.
    for (const wrap of published) {
      const key =
        recipientOf(wrap) === alice.pubkey ? alice.secretKey : bob.secretKey;
      const rumor = Either.getOrThrow(unwrapToRumor(wrap, key));
      expect(rumor.id).toBe(receipt.rumorId);
      expect(rumor.kind).toBe(24136);
      expect(rumor.content).toBe(String(draft.seenUpToSec));
      expect(firstTagValue(rumor.tags, "since")).toBe(String(draft.sinceSec));
      expect(firstTagValue(rumor.tags, "linky")).toBe("seen_receipt");
      expect(firstTagValue(rumor.tags, "client")).toBe("client-42");
      expect(tagValues(rumor.tags, "p")).toEqual([bob.pubkey, alice.pubkey]);
    }
  });
});
