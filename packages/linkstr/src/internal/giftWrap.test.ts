import { Result, Schema } from "effect";
import { getConversationKey } from "nostr-tools/nip44";
import { wrapEvent } from "nostr-tools/nip59";
import { makeIdentity } from "../testing";
import { SignedWrapEvent } from "./nostrEvent";
import { unwrapToRumor } from "./giftWrap";

vi.mock("nostr-tools/nip44", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools/nip44")>();
  return { ...actual, getConversationKey: vi.fn(actual.getConversationKey) };
});

const alice = makeIdentity();
const bob = makeIdentity();
const makeWrap = (createdAt: number, sender = alice) => {
  const fields = {
    pubkey: sender.pubkey,
    created_at: createdAt,
    kind: 14,
    tags: [["p", bob.pubkey]],
    content: "hello",
  };
  return Schema.decodeUnknownSync(SignedWrapEvent)(
    wrapEvent(fields, sender.secretKey, bob.pubkey),
  );
};

describe("authenticated wrap boundaries", () => {
  it("rejects a forged outer signature even when its ciphertext decrypts", () => {
    const wrap = makeWrap(Math.floor(Date.now() / 1000));
    const forged = new SignedWrapEvent({ ...wrap, sig: "00".repeat(64) });
    expect(unwrapToRumor(forged, bob.secretKey)).toEqual(
      Result.fail("invalid-wrap"),
    );
    expect(Result.isSuccess(unwrapToRumor(wrap, bob.secretKey))).toBe(true);
  });

  it("rejects tampered outer tags before decrypting", () => {
    const wrap = makeWrap(Math.floor(Date.now() / 1000));
    const forged = new SignedWrapEvent({
      ...wrap,
      tags: [...wrap.tags, ["p", alice.pubkey]],
    });
    expect(unwrapToRumor(forged, bob.secretKey)).toEqual(
      Result.fail("invalid-wrap"),
    );
  });

  it.each([1, 1_500_000_000])(
    "keeps old history at timestamp %s",
    (timestamp) => {
      expect(
        Result.isSuccess(unwrapToRumor(makeWrap(timestamp), bob.secretKey)),
      ).toBe(true);
    },
  );

  it("allows five minutes of sender clock skew", () => {
    expect(
      Result.isSuccess(
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
        Result.fail("invalid-rumor-timestamp"),
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed timestamp %s",
    (timestamp) => {
      expect(unwrapToRumor(makeWrap(timestamp), bob.secretKey)).toEqual(
        Result.fail("malformed-rumor"),
      );
    },
  );

  it("derives a sender's seal key once across its wraps", () => {
    const carol = makeIdentity();
    const now = Math.floor(Date.now() / 1000);
    const wraps = [makeWrap(now, carol), makeWrap(now, carol)];
    vi.mocked(getConversationKey).mockClear();
    for (const wrap of wraps)
      expect(Result.isSuccess(unwrapToRumor(wrap, bob.secretKey))).toBe(true);
    // One per wrap for its one-off key, one for carol's seals.
    expect(getConversationKey).toHaveBeenCalledTimes(3);
  });
});
