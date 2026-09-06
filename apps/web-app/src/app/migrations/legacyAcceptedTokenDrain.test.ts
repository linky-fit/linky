// Legacy migration; removal gate in docs/architecture.md

import {
  MintUnreachable,
  parseMintUrl,
  ReceiveReceipt,
  TokenAlreadyKnown,
  TokenRowId,
} from "@linky/linkshu";
import { Either, Schema } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { drainLegacyAcceptedCashuToken } from "./legacyAcceptedTokenDrain";

const LEGACY_KEY = "linky.lastAcceptedCashuToken.v1";

const mint = parseMintUrl("https://mint.example");
if (mint === null) throw new Error("test mint url must parse");

const receipt = Schema.decodeUnknownSync(ReceiveReceipt)({
  amount: 21,
  mint: "https://mint.example",
  rowId: "row-1",
  tokenText: "cashuBdrained",
  unit: "sat",
});

describe("drainLegacyAcceptedCashuToken", () => {
  const received: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    received.length = 0;
  });

  it("deletes an empty leftover without calling receive", async () => {
    localStorage.setItem(LEGACY_KEY, "");

    await drainLegacyAcceptedCashuToken((text) => {
      received.push(text);
      return Promise.resolve(Either.right(receipt));
    });

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(received).toEqual([]);
  });

  it("receives a remembered token and deletes the key", async () => {
    localStorage.setItem(LEGACY_KEY, " cashuBremembered ");

    await drainLegacyAcceptedCashuToken((text) => {
      received.push(text);
      return Promise.resolve(Either.right(receipt));
    });

    expect(received).toEqual(["cashuBremembered"]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("deletes the key on a definitive failure (already known)", async () => {
    localStorage.setItem(LEGACY_KEY, "cashuBknown");

    await drainLegacyAcceptedCashuToken(() =>
      Promise.resolve(
        Either.left(new TokenAlreadyKnown({ rowId: TokenRowId.make("row-1") })),
      ),
    );

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("keeps the key when the mint is unreachable", async () => {
    localStorage.setItem(LEGACY_KEY, "cashuBretry");

    await drainLegacyAcceptedCashuToken(() =>
      Promise.resolve(Either.left(new MintUnreachable({ detail: null, mint }))),
    );

    expect(localStorage.getItem(LEGACY_KEY)).toBe("cashuBretry");
  });

  it("keeps the key when receive rejects (runtime shutdown)", async () => {
    localStorage.setItem(LEGACY_KEY, "cashuBinterrupted");

    await drainLegacyAcceptedCashuToken(() =>
      Promise.reject(new Error("runtime disposed")),
    );

    expect(localStorage.getItem(LEGACY_KEY)).toBe("cashuBinterrupted");
  });
});
