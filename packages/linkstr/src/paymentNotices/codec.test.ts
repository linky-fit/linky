import { Either } from "effect";
import { getEventHash } from "nostr-tools";
import { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import { Rumor } from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import { makeIdentity } from "../testing";
import { decodePaymentNoticeRumor, encodePaymentNoticeRumor } from "./codec";
import { PaymentNoticeDraft } from "./domain";

const alice = makeIdentity();
const bob = makeIdentity();
const sentAt = UnixSeconds.make(1_754_000_000);
const clientId = ClientId.make("client-1");

const withHash = (fields: {
  readonly pubkey: Pubkey;
  readonly created_at: UnixSeconds;
  readonly kind: number;
  readonly tags: NostrTags;
  readonly content: string;
}): Rumor => new Rumor({ ...fields, id: getEventHash(fields) });

describe("payment notice rumor encoding", () => {
  it.each([
    {
      name: "bare",
      draft: new PaymentNoticeDraft({ to: bob.pubkey }),
      trailingTags: [],
    },
    {
      name: "with context",
      draft: new PaymentNoticeDraft({
        to: bob.pubkey,
        context: "bank_payment_offer",
      }),
      trailingTags: [["context", "bank_payment_offer"]],
    },
    {
      name: "with context and offer id",
      draft: new PaymentNoticeDraft({
        to: bob.pubkey,
        context: "bank_payment_offer",
        offerId: "offer-1",
      }),
      trailingTags: [
        ["context", "bank_payment_offer"],
        ["offer", "offer-1"],
      ],
    },
  ])("encodes the $name shape in exact order", ({ draft, trailingTags }) => {
    const rumor = encodePaymentNoticeRumor(
      draft,
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(rumor).toEqual(
      expect.objectContaining({
        kind: 24133,
        content: "payment_notice",
        tags: [
          ["p", bob.pubkey],
          ["p", alice.pubkey],
          ["client", clientId],
          ["linky", "payment_notice"],
          ...trailingTags,
        ],
      }),
    );
    expect(rumor.id).toBe(getEventHash(rumor));
  });
});

describe("payment notice rumor decoding", () => {
  const validRumor = encodePaymentNoticeRumor(
    new PaymentNoticeDraft({ to: alice.pubkey }),
    bob.pubkey,
    sentAt,
    clientId,
  );

  it("decodes a valid notice with nullable defaults", () => {
    expect(decodePaymentNoticeRumor(validRumor, alice)).toEqual(
      Either.right(
        expect.objectContaining({
          _tag: "PaymentNoticeReceived",
          noticeId: validRumor.id,
          from: bob.pubkey,
          context: null,
          offerId: null,
          sentAt,
        }),
      ),
    );
  });

  it("keeps an unknown context as null and extracts the first non-empty offer", () => {
    const rumor = withHash({
      pubkey: bob.pubkey,
      created_at: sentAt,
      kind: 24133,
      tags: [
        ["p", alice.pubkey],
        ["linky", "payment_notice"],
        ["context", "future_context"],
        ["offer", "  "],
        ["offer", " offer-1 "],
      ],
      content: "anything",
    });

    expect(decodePaymentNoticeRumor(rumor, alice)).toEqual(
      Either.right(
        expect.objectContaining({ context: null, offerId: "offer-1" }),
      ),
    );
  });

  it.each([
    {
      name: "missing discriminator",
      rumor: new Rumor({
        ...validRumor,
        tags: validRumor.tags.filter((tag) => tag[0] !== "linky"),
      }),
    },
    {
      name: "self-authored",
      rumor: withHash({
        pubkey: alice.pubkey,
        created_at: sentAt,
        kind: 24133,
        tags: [
          ["p", bob.pubkey],
          ["linky", "payment_notice"],
        ],
        content: "payment_notice",
      }),
    },
    {
      name: "not addressed to me",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 24133,
        tags: [
          ["p", bob.pubkey],
          ["linky", "payment_notice"],
        ],
        content: "payment_notice",
      }),
    },
  ])("drops a notice that is $name", ({ rumor }) => {
    expect(decodePaymentNoticeRumor(rumor, alice)).toEqual(
      Either.left("invalid-notice"),
    );
  });
});
