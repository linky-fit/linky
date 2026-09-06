import { Either } from "effect";
import { ClientId, UnixSeconds } from "../domain/primitives";
import { decodeWrapEvent } from "../inbox/decodeWrapEvent";
import { wrapRumorFor } from "../internal/giftWrap";
import { Rumor } from "../internal/nostrEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { makeIdentity } from "../testing";
import { decodeSeenReceiptRumor, encodeSeenReceiptRumor } from "./codec";
import { SeenReceiptDraft } from "./domain";

const decodeWrap = (input: unknown, identity: LinkstrIdentityService) =>
  decodeWrapEvent(input, identity).event;

const alice = makeIdentity();
const bob = makeIdentity();

const clientId = ClientId.make("client-1");
const sentAt = UnixSeconds.make(1_754_000_000);
const sinceSec = UnixSeconds.make(1_753_000_000);
const seenUpToSec = UnixSeconds.make(1_753_999_000);

const draft = new SeenReceiptDraft({ to: bob.pubkey, sinceSec, seenUpToSec });

// Every wrap crosses a JSON boundary so tests exercise the wire shape, not
// class instances.
const overWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("seen receipt roundtrip", () => {
  const rumor = encodeSeenReceiptRumor(draft, alice.pubkey, sentAt, clientId);

  it("recipient copy decodes to SeenReceiptReceived", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    expect(decodeWrap(overWire(wrap), bob)).toEqual(
      expect.objectContaining({
        _tag: "SeenReceiptReceived",
        receiptId: rumor.id,
        from: alice.pubkey,
        sinceSec,
        seenUpToSec,
        sentAt,
      }),
    );
  });

  it("self copy decodes to OwnSeenReceiptConfirmed carrying peer and clientId", () => {
    const wrap = wrapRumorFor(rumor, alice.secretKey, alice.pubkey);
    expect(decodeWrap(overWire(wrap), alice)).toEqual(
      expect.objectContaining({
        _tag: "OwnSeenReceiptConfirmed",
        receiptId: rumor.id,
        to: bob.pubkey,
        sinceSec,
        seenUpToSec,
        clientId,
        sentAt,
      }),
    );
  });

  it("self and recipient copies share the rumor id", () => {
    const selfWrap = wrapRumorFor(rumor, alice.secretKey, alice.pubkey);
    const recipientWrap = wrapRumorFor(rumor, alice.secretKey, bob.pubkey);
    expect(decodeWrap(overWire(selfWrap), alice)).toHaveProperty(
      "receiptId",
      rumor.id,
    );
    expect(decodeWrap(overWire(recipientWrap), bob)).toHaveProperty(
      "receiptId",
      rumor.id,
    );
  });
});

describe("decodeSeenReceiptRumor validation", () => {
  const validRumor = encodeSeenReceiptRumor(
    draft,
    alice.pubkey,
    sentAt,
    clientId,
  );

  const rumorWith = (overrides: Partial<typeof validRumor>): Rumor =>
    new Rumor({ ...validRumor, ...overrides });

  it("rejects a receipt without the linky marker tag", () => {
    const rumor = rumorWith({
      tags: validRumor.tags.filter((tag) => tag[0] !== "linky"),
    });
    expect(decodeSeenReceiptRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-seen-receipt"),
    );
  });

  it.each(["", "abc", "0", "-5", "1.5", "999999999999"])(
    "rejects non-second content %j",
    (content) => {
      const rumor = rumorWith({ content });
      expect(decodeSeenReceiptRumor(rumor, bob.pubkey)).toEqual(
        Either.left("invalid-seen-receipt"),
      );
    },
  );

  it("rejects a receipt without a since tag", () => {
    const rumor = rumorWith({
      tags: validRumor.tags.filter((tag) => tag[0] !== "since"),
    });
    expect(decodeSeenReceiptRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-seen-receipt"),
    );
  });

  it("rejects an empty window (since >= seenUpTo)", () => {
    const rumor = rumorWith({ content: String(sinceSec) });
    expect(decodeSeenReceiptRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-seen-receipt"),
    );
  });

  it("rejects a receipt not addressed to me", () => {
    const mallory = makeIdentity();
    expect(decodeSeenReceiptRumor(validRumor, mallory.pubkey)).toEqual(
      Either.left("not-addressed-to-me"),
    );
  });

  it("rejects a self echo without a peer p-tag", () => {
    const rumor = rumorWith({
      tags: validRumor.tags.filter(
        (tag) => tag[0] !== "p" || tag[1] !== bob.pubkey,
      ),
    });
    expect(decodeSeenReceiptRumor(rumor, alice.pubkey)).toEqual(
      Either.left("invalid-seen-receipt"),
    );
  });

  it("rejects unsupported kinds", () => {
    const rumor = rumorWith({ kind: 1 });
    expect(decodeSeenReceiptRumor(rumor, bob.pubkey)).toEqual(
      Either.left("unsupported-kind"),
    );
  });
});
