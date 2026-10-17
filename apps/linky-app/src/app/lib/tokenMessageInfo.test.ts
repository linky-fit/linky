import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import {
  serializePrivateImageMessage,
  type PrivateImageMessagePayload,
} from "./privateImageMessage";
import {
  cashuTokenStateKey,
  getCashuTokenMessageInfo,
  readCashuTokenMemo,
} from "./tokenMessageInfo";
import { tokenProofsKey } from "./tokenText";

describe("getCashuTokenMessageInfo", () => {
  it("renders cashu.me legacy proof bundles as claimable tokens", () => {
    const bundle = JSON.stringify({
      mint: "https://cashu.cz",
      unit: "sat",
      proofs: [
        { amount: 2, C: "point-a", id: "keyset", secret: "secret-a" },
        { amount: 3, C: "point-b", id: "keyset", secret: "secret-b" },
      ],
    });

    expect(getCashuTokenMessageInfo(bundle)).toMatchObject({
      amount: 5,
      isValid: true,
      mintUrl: "https://cashu.cz",
      unit: "sat",
    });
  });

  it("ignores bank payment offer messages", () => {
    const bankOffer = JSON.stringify({
      amountSat: 76,
      amountText: "76 sat",
      offerId: "offer-1",
      offererPublicKey: "pubkey",
      status: "offered",
      statusUpdatedAtSec: 1,
      text: "Nabízím platbu za 76 sat",
      type: "linky.bank_payment_offer",
      version: 1,
    });

    expect(getCashuTokenMessageInfo(bankOffer)).toBeNull();
  });

  it("ignores private image messages", () => {
    const payload = {
      encryptedSha256: "a".repeat(64),
      encryptedSize: 1234,
      encryptionAlgorithm: "aes-gcm",
      fileType: "image/jpeg",
      height: 600,
      key: "b".repeat(64),
      nonce: "c".repeat(24),
      originalSha256: "d".repeat(64),
      storageEncoding: "raw",
      type: "linky.private_image.v1",
      url: "https://blossom.example/blob",
      width: 800,
    } satisfies PrivateImageMessagePayload;

    expect(
      getCashuTokenMessageInfo(serializePrivateImageMessage(payload)),
    ).toBeNull();
    expect(getCashuTokenMessageInfo(JSON.stringify(payload))).toBeNull();
  });

  it("ignores empty zero-value Cashu payloads", () => {
    expect(
      getCashuTokenMessageInfo(buildCashuToken({ amounts: [] })),
    ).toBeNull();
  });

  it("treats a token a wallet transfer carries as already known", () => {
    const token = buildCashuToken();
    const taken = new Set([tokenProofsKey(token) ?? ""]);

    expect(getCashuTokenMessageInfo(token, taken)?.isValid).toBe(false);
    expect(getCashuTokenMessageInfo(token, new Set())?.isValid).toBe(true);
  });

  it("exposes the token memo and reads it for the transaction note", () => {
    const token = buildCashuToken({ memo: " coffee " });

    expect(getCashuTokenMessageInfo(token)?.memo).toBe("coffee");
    expect(readCashuTokenMemo(token)).toBe("coffee");
    expect(getCashuTokenMessageInfo(buildCashuToken())?.memo).toBeNull();
    expect(readCashuTokenMemo(buildCashuToken())).toBeNull();
  });

  it("flags a test-mint token only while test mints are off", () => {
    const token = buildCashuToken({ mint: "http://localhost:3338" });

    expect(
      getCashuTokenMessageInfo(token, new Set(), false)?.isHiddenTestMint,
    ).toBe(true);
    expect(
      getCashuTokenMessageInfo(token, new Set(), true)?.isHiddenTestMint,
    ).toBe(false);
    expect(
      getCashuTokenMessageInfo(buildCashuToken(), new Set(), false)
        ?.isHiddenTestMint,
    ).toBe(false);
  });
});

describe("cashuTokenStateKey", () => {
  const token = buildCashuToken();
  const key = tokenProofsKey(token) ?? "";
  const stateOf = (
    taken: boolean,
    sentClaims: ReadonlyMap<string, boolean> = new Map(),
    outgoing = true,
    received = false,
  ) => {
    const info = getCashuTokenMessageInfo(
      token,
      new Set(taken ? [key] : []),
      true,
      sentClaims,
      new Set(received ? [key] : []),
    );
    return info && cashuTokenStateKey(info, outgoing);
  };

  it("announces an own send the recipient claimed as claimed, not as an error", () => {
    expect(stateOf(true, new Map([[key, true]]))).toBe("cashuTokenClaimed");
  });

  it("announces nothing for an own send that is still out", () => {
    expect(stateOf(true, new Map([[key, false]]))).toBeNull();
  });

  it("keeps the error for a token the wallet took that it did not send", () => {
    expect(stateOf(true)).toBe("cashuInvalid");
    expect(stateOf(false)).toBeNull();
  });

  it("announces an incoming token the wallet received as received", () => {
    expect(stateOf(true, new Map(), false, true)).toBe("cashuTokenReceived");
    expect(stateOf(true, new Map(), true, true)).toBe("cashuInvalid");
  });

  it("keeps the error for an own send a peer sent back, claimed or not", () => {
    expect(stateOf(true, new Map([[key, true]]), false)).toBe("cashuInvalid");
    expect(stateOf(true, new Map([[key, false]]), false)).toBe("cashuInvalid");
  });
});
