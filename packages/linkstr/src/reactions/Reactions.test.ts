import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl, RumorId, UnixSeconds } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import { firstTagValue, tagValues } from "../internal/nostrEvent";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, recipientOf, stubWrapTransport } from "../testing";
import { Emoji, ReactionDraft, RetractionDraft } from "./domain";
import { Reactions } from "./Reactions";

const alice = makeIdentity();
const bob = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const draft = new ReactionDraft({
  to: bob.pubkey,
  target: RumorId.make("ab".repeat(32)),
  targetKind: "image",
  targetAuthor: bob.pubkey,
  emoji: Emoji.make("🔥"),
  clientId: ClientId.make("client-42"),
});

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, Reactions>,
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
      Effect.provide(Reactions.Default.pipe(Layer.provide(dependencies))),
    ),
  );
};

describe("Reactions.react", () => {
  it("publishes one wrap per copy and returns a full receipt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const reactions = yield* Reactions;
        return yield* reactions.react(draft);
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
      expect(rumor.kind).toBe(7);
      expect(rumor.content).toBe("🔥");
      expect(firstTagValue(rumor.tags, "k")).toBe("15");
      expect(firstTagValue(rumor.tags, "client")).toBe("client-42");
      expect(tagValues(rumor.tags, "p")).toEqual([
        bob.pubkey,
        bob.pubkey,
        alice.pubkey,
      ]);
    }
  });

  it("honors the draft sentAt override", async () => {
    const published: Array<SignedWrapEvent> = [];
    const sentAt = UnixSeconds.make(1_699_999_999);
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const reactions = yield* Reactions;
        return yield* reactions.react(new ReactionDraft({ ...draft, sentAt }));
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.sentAt).toBe(sentAt);
    const recipient = published.find(
      (wrap) => recipientOf(wrap) === bob.pubkey,
    );
    assert(recipient !== undefined);
    const rumor = Either.getOrThrow(unwrapToRumor(recipient, bob.secretKey));
    expect(rumor.created_at).toBe(sentAt);
    expect(rumor.id).toBe(exit.value.rumorId);
  });
});

describe("Reactions.retract", () => {
  it("publishes a kind-5 rumor referencing the reactions", async () => {
    const published: Array<SignedWrapEvent> = [];
    const reactionIds: [RumorId, RumorId] = [
      RumorId.make("cd".repeat(32)),
      RumorId.make("ef".repeat(32)),
    ];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const reactions = yield* Reactions;
        return yield* reactions.retract(
          new RetractionDraft({ to: bob.pubkey, reactionIds }),
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(2);
    const selfPublished = published.find(
      (wrap) => recipientOf(wrap) === alice.pubkey,
    );
    assert(selfPublished !== undefined);
    const rumor = Either.getOrThrow(
      unwrapToRumor(selfPublished, alice.secretKey),
    );
    expect(rumor.kind).toBe(5);
    expect(rumor.content).toBe("");
    expect(tagValues(rumor.tags, "e")).toEqual(reactionIds);
    expect(rumor.id).toBe(exit.value.rumorId);
    // A generated clientId still travels on the wire for echo reconciliation.
    expect(firstTagValue(rumor.tags, "client")).toBe(exit.value.clientId);
  });
});
