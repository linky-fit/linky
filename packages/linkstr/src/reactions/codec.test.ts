import { Either } from "effect";
import { finalizeEvent } from "nostr-tools";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { createWrap } from "nostr-tools/nip59";
import { decodeWrapEvent } from "../inbox/decodeWrapEvent";
import { wrapRumorFor } from "../internal/giftWrap";
import { Rumor } from "../internal/nostrEvent";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import {
  decodeReactionRumor,
  encodeReactionRumor,
  encodeRetractionRumor,
} from "./codec";
import { makeIdentity } from "../testing";
import { Emoji, ReactionDraft, RetractionDraft } from "./domain";

const decodeWrap = (input: unknown, identity: LinkstrIdentityService) =>
  decodeWrapEvent(input, identity).event;

const alice = makeIdentity();
const bob = makeIdentity();

const targetId = RumorId.make("ab".repeat(32));
const clientId = ClientId.make("client-1");
const sentAt = UnixSeconds.make(1_754_000_000);

const draft = new ReactionDraft({
  to: bob.pubkey,
  target: targetId,
  targetKind: "text",
  targetAuthor: bob.pubkey,
  emoji: Emoji.make("👍"),
});

// Every wrap crosses a JSON boundary so tests exercise the wire shape, not
// class instances.
const overWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("reaction roundtrip", () => {
  const rumor = encodeReactionRumor(draft, alice.pubkey, sentAt, clientId);

  it("recipient copy decodes to ReactionAdded", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    const outcome = decodeWrap(overWire(wrap), bob);

    expect(outcome).toEqual(
      expect.objectContaining({
        _tag: "ReactionAdded",
        reactionId: rumor.id,
        target: targetId,
        from: alice.pubkey,
        emoji: "👍",
        sentAt,
      }),
    );
  });

  it("self copy decodes to OwnReactionConfirmed carrying the clientId", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, alice.pubkey);
    const outcome = decodeWrap(overWire(wrap), alice);

    expect(outcome).toEqual(
      expect.objectContaining({
        _tag: "OwnReactionConfirmed",
        reactionId: rumor.id,
        target: targetId,
        emoji: "👍",
        clientId,
        sentAt,
      }),
    );
  });

  it("self and recipient copies share the rumor id", () => {
    const selfWrap = wrapRumorFor(rumor, alice.secretKey, alice.pubkey);
    const recipientWrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    const selfOutcome = decodeWrap(overWire(selfWrap), alice);
    const recipientOutcome = decodeWrap(overWire(recipientWrap), bob);

    expect(selfOutcome).toHaveProperty("reactionId", rumor.id);
    expect(recipientOutcome).toHaveProperty("reactionId", rumor.id);
  });
});

describe("retraction roundtrip", () => {
  it("decodes to ReactionRetracted with all referenced ids", () => {
    const otherReactionId = RumorId.make("cd".repeat(32));
    const retraction = new RetractionDraft({
      to: bob.pubkey,
      reactionIds: [targetId, otherReactionId],
    });
    const rumor = encodeRetractionRumor(
      retraction,
      alice.pubkey,
      sentAt,
      clientId,
    );
    const wrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);

    expect(decodeWrap(overWire(wrap), bob)).toEqual(
      expect.objectContaining({
        _tag: "ReactionRetracted",
        reactionIds: [targetId, otherReactionId],
        from: alice.pubkey,
        sentAt,
      }),
    );
  });
});

describe("dropped wraps", () => {
  const rumor = encodeReactionRumor(draft, alice.pubkey, sentAt, clientId);

  it("drops garbage input as malformed-wrap", () => {
    expect(decodeWrap({ hello: "world" }, bob)).toEqual(
      expect.objectContaining({
        _tag: "WrapDropped",
        reason: "malformed-wrap",
      }),
    );
  });

  it("drops a wrap addressed to someone else", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    expect(decodeWrap(overWire(wrap), alice)).toEqual(
      expect.objectContaining({ reason: "not-addressed-to-me" }),
    );
  });

  it("drops a wrap it cannot decrypt", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    const mallory = makeIdentity();
    const readdressed = overWire({ ...wrap, tags: [["p", mallory.pubkey]] });
    expect(decodeWrap(readdressed, mallory)).toEqual(
      expect.objectContaining({ reason: "unwrap-failed" }),
    );
  });
});

describe("forged wraps", () => {
  // Hand-rolled NIP-59 so tests can produce envelopes wrapEvent never would.
  const sealFor = (
    rumorJson: unknown,
    sealAuthor: LinkstrIdentityService,
    recipient: Pubkey,
  ) =>
    finalizeEvent(
      {
        kind: 13,
        created_at: sentAt,
        tags: [],
        content: encrypt(
          JSON.stringify(rumorJson),
          getConversationKey(sealAuthor.secretKey, recipient),
        ),
      },
      sealAuthor.secretKey,
    );

  const honestRumor = encodeReactionRumor(
    draft,
    alice.pubkey,
    sentAt,
    clientId,
  );

  it("drops a rumor whose id is not its hash", () => {
    const forged = { ...honestRumor, id: "11".repeat(32) };
    const wrap = createWrap(sealFor(forged, alice, bob.pubkey), bob.pubkey);
    expect(decodeWrap(overWire(wrap), bob)).toEqual(
      expect.objectContaining({ reason: "forged-rumor-id" }),
    );
  });

  it("drops a rumor claiming another author than the seal's", () => {
    const mallory = makeIdentity();
    // Mallory seals a rumor that pretends to come from Alice.
    const wrap = createWrap(
      sealFor(honestRumor, mallory, bob.pubkey),
      bob.pubkey,
    );
    expect(decodeWrap(overWire(wrap), bob)).toEqual(
      expect.objectContaining({ reason: "sender-forged" }),
    );
  });

  it("drops a wrap whose seal signature does not verify", () => {
    const seal = sealFor(honestRumor, alice, bob.pubkey);
    const lastChar = seal.sig.endsWith("0") ? "1" : "0";
    const tampered = { ...seal, sig: seal.sig.slice(0, -1) + lastChar };
    const wrap = createWrap(tampered, bob.pubkey);
    expect(decodeWrap(overWire(wrap), bob)).toEqual(
      expect.objectContaining({ reason: "invalid-seal" }),
    );
  });
});

describe("own retraction echo", () => {
  it("decodes the self copy to OwnRetractionConfirmed", () => {
    const retraction = new RetractionDraft({
      to: bob.pubkey,
      reactionIds: [targetId],
    });
    const rumor = encodeRetractionRumor(
      retraction,
      alice.pubkey,
      sentAt,
      clientId,
    );
    const wrap = wrapRumorFor(rumor, alice.secretKey, alice.pubkey);

    expect(decodeWrap(overWire(wrap), alice)).toEqual(
      expect.objectContaining({
        _tag: "OwnRetractionConfirmed",
        retractionId: rumor.id,
        reactionIds: [targetId],
        clientId,
        sentAt,
      }),
    );
  });
});

describe("decodeReactionRumor validation", () => {
  const validRumor = encodeReactionRumor(draft, alice.pubkey, sentAt, clientId);

  const rumorWith = (overrides: Partial<typeof validRumor>): Rumor =>
    new Rumor({ ...validRumor, ...overrides });

  it("rejects a reaction to a non-chat kind", () => {
    const rumor = rumorWith({
      tags: validRumor.tags.map((tag) => (tag[0] === "k" ? ["k", "1"] : tag)),
    });
    expect(decodeReactionRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-reaction"),
    );
  });

  it("rejects an empty emoji", () => {
    const rumor = rumorWith({ content: "   " });
    expect(decodeReactionRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-reaction"),
    );
  });

  it("rejects a reaction without a target", () => {
    const rumor = rumorWith({
      tags: validRumor.tags.filter((tag) => tag[0] !== "e"),
    });
    expect(decodeReactionRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-reaction"),
    );
  });

  it("rejects a retraction without valid references", () => {
    const rumor = rumorWith({ kind: 5, tags: [["e", "not-hex"]] });
    expect(decodeReactionRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-retraction"),
    );
  });

  it("rejects unsupported kinds", () => {
    const rumor = rumorWith({ kind: 1 });
    expect(decodeReactionRumor(rumor, bob.pubkey)).toEqual(
      Either.left("unsupported-kind"),
    );
  });
});
