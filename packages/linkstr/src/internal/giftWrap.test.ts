import { Either, Schema } from "effect";
import { wrapEvent } from "nostr-tools/nip59";
import { makeIdentity } from "../testing";
import { SignedWrapEvent } from "./nostrEvent";
import { unwrapToRumor } from "./giftWrap";

const alice = makeIdentity();
const bob = makeIdentity();
const makeWrap = (createdAt: number) => {
  const fields = {
    pubkey: alice.pubkey,
    created_at: createdAt,
    kind: 14,
    tags: [["p", bob.pubkey]],
    content: "hello",
  };
  return Schema.decodeUnknownSync(SignedWrapEvent)(
    wrapEvent(fields, alice.secretKey, bob.pubkey),
  );
};

describe("authenticated wrap boundaries", () => {
  it("rejects a forged outer signature even when its ciphertext decrypts", () => {
    const wrap = makeWrap(Math.floor(Date.now() / 1000));
    const forged = new SignedWrapEvent({ ...wrap, sig: "00".repeat(64) });
    expect(unwrapToRumor(forged, bob.secretKey)).toEqual(
      Either.left("invalid-wrap"),
    );
    expect(Either.isRight(unwrapToRumor(wrap, bob.secretKey))).toBe(true);
  });

  it("rejects tampered outer tags before decrypting", () => {
    const wrap = makeWrap(Math.floor(Date.now() / 1000));
    const forged = new SignedWrapEvent({
      ...wrap,
      tags: [...wrap.tags, ["p", alice.pubkey]],
    });
    expect(unwrapToRumor(forged, bob.secretKey)).toEqual(
      Either.left("invalid-wrap"),
    );
  });

  it.each([1, 1_500_000_000])(
    "keeps old history at timestamp %s",
    (timestamp) => {
      expect(
        Either.isRight(unwrapToRumor(makeWrap(timestamp), bob.secretKey)),
      ).toBe(true);
    },
  );

  it("allows five minutes of sender clock skew", () => {
    expect(
      Either.isRight(
        unwrapToRumor(
          makeWrap(Math.floor(Date.now() / 1000) + 300),
          bob.secretKey,
        ),
      ),
    ).toBe(true);
  });

  it.each([Math.floor(Date.now() / 1000) + 3600, Number.MAX_SAFE_INTEGER])(
    "rejects unbounded rumor timestamp %s",
    (timestamp) => {
      expect(unwrapToRumor(makeWrap(timestamp), bob.secretKey)).toEqual(
        Either.left("invalid-rumor-timestamp"),
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed timestamp %s",
    (timestamp) => {
      expect(unwrapToRumor(makeWrap(timestamp), bob.secretKey)).toEqual(
        Either.left("malformed-rumor"),
      );
    },
  );
});
