import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import { createCashuTokenRowFixture } from "../../testUtils/cashuTokenRow";
import {
  extractCashuTokenFromText,
  extractCashuTokenMeta,
  isStandaloneCashuTokenMessage,
} from "./tokenText";

describe("extractCashuTokenMeta", () => {
  it("derives mint, unit, and amount from the token", () => {
    const token = buildCashuToken({ amounts: [8, 13] });

    expect(
      extractCashuTokenMeta(createCashuTokenRowFixture({ token })),
    ).toEqual({
      tokenText: token,
      mint: "https://mint.example",
      unit: "sat",
      amount: 21,
    });
  });

  it("prefers token metadata over deprecated stored snapshots", () => {
    const token = buildCashuToken({ amounts: [8, 13] });

    expect(
      extractCashuTokenMeta({
        ...createCashuTokenRowFixture({
          token,
          mint: "https://stale.example",
          unit: "usd",
          amount: 999,
        }),
      }),
    ).toEqual({
      tokenText: token,
      mint: "https://mint.example",
      unit: "sat",
      amount: 21,
    });
  });
});

describe("extractCashuTokenFromText", () => {
  it("normalizes cashu.me legacy proof bundles into claimable tokens", () => {
    const bundle = JSON.stringify({
      id: "cashu-me-export",
      mint: "https://cashu.cz",
      unit: "sat",
      proofs: [
        [
          {
            amount: 2,
            C: "02dd3b2ff2dc98425b2d9095ab73d71bd03a0a2402c905b8320afc67ab5b08634a",
            id: "01ba87f253ad005f869fbd4828d14bb912c907c266202d34ff4cab9e761ce39104",
            secret:
              "fa3d7de4eec37277a345e14716e00803abca7740f638c5cda8f3f11cb2452080",
          },
          {
            amount: 3,
            C: "03a76110ee8a28d8cd62184d371161302ade073a7bd12dfe862aec7c36fa4d6731",
            id: "01ba87f253ad005f869fbd4828d14bb912c907c266202d34ff4cab9e761ce39104",
            secret:
              "5bd0339128d0001e17b469e3063dee386b6706289b05e4ed069cdf82e1ff295c",
          },
        ],
      ],
    });

    const token = extractCashuTokenFromText(bundle);

    expect(token).toMatch(/^cashuA/);
    expect(extractCashuTokenFromText(bundle)).toBe(token);
    expect(isStandaloneCashuTokenMessage(bundle)).toBe(true);
  });

  it("recognizes a flat legacy proof bundle as a standalone chat token", () => {
    const bundle = JSON.stringify({
      id: "cashu-chat-message",
      mint: "https://cashu.cz",
      unit: "sat",
      proofs: [
        {
          amount: 2,
          C: "02dd3b2ff2dc98425b2d9095ab73d71bd03a0a2402c905b8320afc67ab5b08634a",
          id: "01ba87f253ad005f869fbd4828d14bb912c907c266202d34ff4cab9e761ce39104",
          dleq: {
            e: "eb14fe8d355f00f635b57f13d52999cb32906770b5a5c160af0f0f683c0566dd",
            r: "60178ed825e7c8e5d6c10f4c47c2ca204c02b905bf1d0dccc8c56c98145631f2",
            s: "eeec572c729b4ebc75bf876d586a0635be83f95d552bacdf974bebc05056557c",
          },
          secret:
            "fa3d7de4eec37277a345e14716e00803abca7740f638c5cda8f3f11cb2452080",
        },
      ],
    });

    expect(isStandaloneCashuTokenMessage(bundle)).toBe(true);
  });

  it("does not treat bank payment offers as Cashu tokens", () => {
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

    expect(extractCashuTokenFromText(bankOffer)).toBeNull();
  });

  it("does not treat SPD bank payment payloads as Cashu tokens", () => {
    expect(
      extractCashuTokenFromText(
        "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*MSG:Faktura",
      ),
    ).toBeNull();
  });

  it("extracts a scanned cashu deep link token", () => {
    const token = buildCashuToken();

    expect(extractCashuTokenFromText(`cashu://${token}`)).toBe(token);
    expect(extractCashuTokenFromText(`web+cashu://${token}`)).toBe(token);
  });

  it("extracts a token from wallet deeplink URLs", () => {
    const token = buildCashuToken();

    expect(
      extractCashuTokenFromText(`https://app.linky.fit/#wallet?cashu=${token}`),
    ).toBe(token);
    expect(
      extractCashuTokenFromText(`https://app.linky.fit/cashu/${token}`),
    ).toBe(token);
  });
});
