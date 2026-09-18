import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import {
  serializePrivateImageMessage,
  type PrivateImageMessagePayload,
} from "./privateImageMessage";
import { getCashuTokenMessageInfo } from "./tokenMessageInfo";

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

    expect(getCashuTokenMessageInfo(token, new Set([token]))?.isValid).toBe(
      false,
    );
    expect(getCashuTokenMessageInfo(token, new Set())?.isValid).toBe(true);
  });
});
