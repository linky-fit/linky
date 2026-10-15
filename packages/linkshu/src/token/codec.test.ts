import { getEncodedToken, Amount as CashuAmount } from "@cashu/cashu-ts";
import { Amount, CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import {
  decodeTokenText,
  encodeToken,
  extractTokenText,
  normalizeTokenText,
  parseTokenText,
  tokenProofSecrets,
} from "./codec";
import { DecodedToken, ParsedToken, Proof } from "./domain";

const base64Url = (json: string): string =>
  Buffer.from(json).toString("base64url");

const V1_KEYSET_ID = "009a1f293253e41e";
const V2_KEYSET_ID =
  "01ba87f253ad005f869fbd4828d14bb912c907c266202d34ff4cab9e761ce39104";
const HEX_C = "02" + "cd".repeat(32);

interface V3TokenInput {
  mint: string;
  proofs: ReadonlyArray<Record<string, unknown>>;
  unit?: string;
  memo?: string;
}

const buildV3Token = ({ mint, proofs, unit, memo }: V3TokenInput): string =>
  "cashuA" +
  base64Url(
    JSON.stringify({
      token: [{ mint, proofs }],
      ...(unit === undefined ? {} : { unit }),
      ...(memo === undefined ? {} : { memo }),
    }),
  );

const buildV4Token = (keysetId: string, memo?: string): string =>
  getEncodedToken({
    mint: "https://mint.example",
    unit: "sat",
    ...(memo === undefined ? {} : { memo }),
    proofs: [
      {
        id: keysetId,
        amount: CashuAmount.from(21),
        secret: "test-secret",
        C: HEX_C,
      },
    ],
  });

const basicV3 = buildV3Token({
  mint: "https://mint.example",
  proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: HEX_C }],
});

const LEGACY_PROOF_1 = {
  amount: 2,
  C: "02dd3b2ff2dc98425b2d9095ab73d71bd03a0a2402c905b8320afc67ab5b08634a",
  id: V2_KEYSET_ID,
  secret: "fa3d7de4eec37277a345e14716e00803abca7740f638c5cda8f3f11cb2452080",
};

const LEGACY_PROOF_2 = {
  amount: 3,
  C: "03a76110ee8a28d8cd62184d371161302ade073a7bd12dfe862aec7c36fa4d6731",
  id: V2_KEYSET_ID,
  secret: "5bd0339128d0001e17b469e3063dee386b6706289b05e4ed069cdf82e1ff295c",
};

const legacyNestedBundle = JSON.stringify({
  id: "cashu-me-export",
  mint: "https://cashu.cz",
  unit: "sat",
  proofs: [[LEGACY_PROOF_1, LEGACY_PROOF_2]],
});

describe("decodeTokenText", () => {
  it("decodes a v3 token without a unit field, defaulting to sat", () => {
    expect(decodeTokenText(basicV3)).toEqual(
      new DecodedToken({
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
        proofs: [
          new Proof({
            id: KeysetId.make(V1_KEYSET_ID),
            amount: Amount.make(21),
            secret: "secret",
            C: HEX_C,
          }),
        ],
      }),
    );
  });

  it("carries unit and memo from the v3 payload", () => {
    const token = buildV3Token({
      mint: "https://mint.example",
      proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: HEX_C }],
      unit: "sat",
      memo: "thanks",
    });

    const decoded = decodeTokenText(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.memo).toBe("thanks");
    expect(decoded?.unit).toBe(CurrencyUnit.make("sat"));
  });

  it("strips trailing slashes from the mint url", () => {
    const token = buildV3Token({
      mint: "https://mint.example/",
      proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: HEX_C }],
    });

    expect(decodeTokenText(token)?.mint).toBe(
      MintUrl.make("https://mint.example"),
    );
  });

  it("rejects multi-entry v3 tokens", () => {
    const multi =
      "cashuA" +
      base64Url(
        JSON.stringify({
          token: [
            {
              mint: "https://mint-a.example",
              proofs: [{ id: V1_KEYSET_ID, amount: 1, secret: "s", C: "c" }],
            },
            {
              mint: "https://mint-b.example",
              proofs: [{ id: V1_KEYSET_ID, amount: 2, secret: "s", C: "c" }],
            },
          ],
        }),
      );

    expect(decodeTokenText(multi)).toBeNull();
  });

  it("rejects a v3 token with an empty proofs array", () => {
    const empty = buildV3Token({
      mint: "https://mint.example",
      proofs: [],
    });

    expect(decodeTokenText(empty)).toBeNull();
  });

  it("returns null for malformed cashu-prefixed input without throwing", () => {
    expect(decodeTokenText("cashu-invalid")).toBeNull();
  });

  it("returns null for empty and whitespace-only input", () => {
    expect(decodeTokenText("")).toBeNull();
    expect(decodeTokenText("   ")).toBeNull();
  });

  it("rejects fractional, zero, and negative proof amounts", () => {
    for (const amount of [2.5, 0, -1]) {
      const token = buildV3Token({
        mint: "https://mint.example",
        proofs: [{ id: V1_KEYSET_ID, amount, secret: "secret", C: "c" }],
      });
      expect(decodeTokenText(token)).toBeNull();
    }
  });

  it("rejects a proof with a non-hex keyset id", () => {
    const token = buildV3Token({
      mint: "https://mint.example",
      proofs: [{ id: "not-hex!", amount: 21, secret: "secret", C: "c" }],
    });

    expect(decodeTokenText(token)).toBeNull();
  });

  it("decodes a v4 token built by cashu-ts", () => {
    expect(decodeTokenText(buildV4Token(V1_KEYSET_ID, "hi"))).toEqual(
      new DecodedToken({
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        memo: "hi",
        proofs: [
          new Proof({
            id: KeysetId.make(V1_KEYSET_ID),
            amount: Amount.make(21),
            secret: "test-secret",
            C: HEX_C,
          }),
        ],
      }),
    );
  });

  it("returns null for a v4 token carrying a short v2 keyset id", () => {
    expect(decodeTokenText(buildV4Token(V2_KEYSET_ID))).toBeNull();
  });

  it("decodes a v3 token with a full 66-char v2 keyset id, keeping the full id", () => {
    const token = buildV3Token({
      mint: "https://mint.example",
      proofs: [{ id: V2_KEYSET_ID, amount: 21, secret: "secret", C: HEX_C }],
    });

    const decoded = decodeTokenText(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.proofs[0]?.id).toBe(KeysetId.make(V2_KEYSET_ID));
  });

  it("decodes a legacy cashu.me JSON bundle passed directly", () => {
    expect(decodeTokenText(legacyNestedBundle)).toEqual(
      new DecodedToken({
        mint: MintUrl.make("https://cashu.cz"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
        proofs: [
          new Proof({
            id: KeysetId.make(V2_KEYSET_ID),
            amount: Amount.make(2),
            secret: LEGACY_PROOF_1.secret,
            C: LEGACY_PROOF_1.C,
          }),
          new Proof({
            id: KeysetId.make(V2_KEYSET_ID),
            amount: Amount.make(3),
            secret: LEGACY_PROOF_2.secret,
            C: LEGACY_PROOF_2.C,
          }),
        ],
      }),
    );
  });

  it("drops extra proof fields such as dleq from the result", () => {
    const token = buildV3Token({
      mint: "https://mint.example",
      proofs: [
        {
          id: V1_KEYSET_ID,
          amount: 21,
          secret: "secret",
          C: HEX_C,
          dleq: { e: "aa", r: "bb", s: "cc" },
        },
      ],
    });

    expect(decodeTokenText(token)).toEqual(
      new DecodedToken({
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
        proofs: [
          new Proof({
            id: KeysetId.make(V1_KEYSET_ID),
            amount: Amount.make(21),
            secret: "secret",
            C: HEX_C,
          }),
        ],
      }),
    );
  });
});

describe("tokenProofSecrets", () => {
  it("names the same proofs as v4 text with a short keyset id, v3 text and a NUT-18 payload", () => {
    const payload = JSON.stringify({
      id: "pay-1",
      mint: "https://mint.example",
      unit: "sat",
      proofs: [
        { id: V2_KEYSET_ID, amount: 21, secret: "test-secret", C: HEX_C },
      ],
    });
    const v3 = buildV3Token({
      mint: "https://mint.example",
      proofs: [
        { id: V1_KEYSET_ID, amount: 21, secret: "test-secret", C: HEX_C },
      ],
    });

    expect(tokenProofSecrets(buildV4Token(V2_KEYSET_ID))).toEqual(
      new Set(["test-secret"]),
    );
    expect(tokenProofSecrets(v3)).toEqual(new Set(["test-secret"]));
    expect(tokenProofSecrets(payload)).toEqual(new Set(["test-secret"]));
  });

  it("returns null for text that is not a token", () => {
    expect(tokenProofSecrets("hello")).toBeNull();
    expect(tokenProofSecrets("cashuBnotcbor")).toBeNull();
  });
});

describe("encodeToken", () => {
  it("emits canonical v4 text", () => {
    const decoded = new DecodedToken({
      mint: MintUrl.make("https://mint.example"),
      unit: CurrencyUnit.make("sat"),
      memo: null,
      proofs: [
        new Proof({
          id: KeysetId.make(V1_KEYSET_ID),
          amount: Amount.make(21),
          secret: "secret",
          C: HEX_C,
        }),
      ],
    });

    expect(encodeToken(decoded)).toMatch(/^cashuB/);
  });

  it("round-trips losslessly for v1 keyset ids, with and without memo", () => {
    for (const memo of ["hi", undefined]) {
      const token = buildV3Token({
        mint: "https://mint.example",
        proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: HEX_C }],
        unit: "sat",
        ...(memo === undefined ? {} : { memo }),
      });

      const decoded = decodeTokenText(token);
      expect(decoded).not.toBeNull();
      if (decoded === null) return;

      expect(decodeTokenText(encodeToken(decoded))).toEqual(decoded);
    }
  });
});

describe("parseTokenText", () => {
  it("summarizes a v3 token, defaulting unit to sat", () => {
    expect(parseTokenText(basicV3)).toEqual(
      new ParsedToken({
        amount: Amount.make(21),
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
      }),
    );
  });

  it("returns a null mint when the mint string is not a valid url", () => {
    const token = buildV3Token({
      mint: "not a url",
      proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: "c" }],
    });

    expect(parseTokenText(token)).toEqual(
      new ParsedToken({
        amount: Amount.make(21),
        mint: null,
        unit: CurrencyUnit.make("sat"),
        memo: null,
      }),
    );
  });

  it("summarizes a v4 token even when its proofs cannot fully decode", () => {
    expect(parseTokenText(buildV4Token(V2_KEYSET_ID))).toEqual(
      new ParsedToken({
        amount: Amount.make(21),
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
      }),
    );
  });

  it("returns null for multi-entry, empty, and malformed input", () => {
    const multi =
      "cashuA" +
      base64Url(
        JSON.stringify({
          token: [
            {
              mint: "https://mint-a.example",
              proofs: [{ id: V1_KEYSET_ID, amount: 1, secret: "s", C: "c" }],
            },
            {
              mint: "https://mint-b.example",
              proofs: [{ id: V1_KEYSET_ID, amount: 2, secret: "s", C: "c" }],
            },
          ],
        }),
      );

    expect(parseTokenText(multi)).toBeNull();
    expect(parseTokenText("")).toBeNull();
    expect(parseTokenText("cashu-invalid")).toBeNull();
  });

  it("passes the memo through", () => {
    const token = buildV3Token({
      mint: "https://mint.example",
      proofs: [{ id: V1_KEYSET_ID, amount: 21, secret: "secret", C: "c" }],
      memo: "thanks",
    });

    expect(parseTokenText(token)?.memo).toBe("thanks");
  });
});

describe("normalizeTokenText", () => {
  it("passes cashu-prefixed text through unchanged, trimming whitespace", () => {
    expect(normalizeTokenText(basicV3)).toBe(basicV3);
    expect(normalizeTokenText(`  ${basicV3}  `)).toBe(basicV3);
  });

  it("normalizes cashu.me legacy nested proof bundles byte-identically to the old app", () => {
    const expected =
      "cashuA" +
      base64Url(
        JSON.stringify({
          token: [
            {
              mint: "https://cashu.cz",
              proofs: [LEGACY_PROOF_1, LEGACY_PROOF_2],
            },
          ],
          unit: "sat",
        }),
      );

    const normalized = normalizeTokenText(legacyNestedBundle);

    expect(normalized).toMatch(/^cashuA/);
    expect(normalizeTokenText(legacyNestedBundle)).toBe(normalized);
    expect(normalized).toBe(expected);

    expect(parseTokenText(legacyNestedBundle)).toEqual(
      new ParsedToken({
        amount: Amount.make(5),
        mint: MintUrl.make("https://cashu.cz"),
        unit: CurrencyUnit.make("sat"),
        memo: null,
      }),
    );

    const decoded = decodeTokenText(legacyNestedBundle);
    expect(decoded?.proofs).toHaveLength(2);
    expect(decoded?.proofs.map((proof) => proof.id)).toEqual([
      KeysetId.make(V2_KEYSET_ID),
      KeysetId.make(V2_KEYSET_ID),
    ]);
  });

  it("keeps dleq data when normalizing a flat legacy proof bundle", () => {
    const bundle = JSON.stringify({
      id: "cashu-chat-message",
      mint: "https://cashu.cz",
      unit: "sat",
      proofs: [
        {
          amount: 2,
          C: "02dd3b2ff2dc98425b2d9095ab73d71bd03a0a2402c905b8320afc67ab5b08634a",
          id: V2_KEYSET_ID,
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

    const normalized = normalizeTokenText(bundle);

    expect(normalized).not.toBeNull();
    if (normalized === null) return;

    const payload = Buffer.from(
      normalized.slice("cashuA".length),
      "base64url",
    ).toString();
    expect(payload).toContain('"dleq"');

    expect(parseTokenText(bundle)?.amount).toBe(Amount.make(2));
  });

  it("rejects invalid legacy bundles", () => {
    const withoutMint = JSON.stringify({
      unit: "sat",
      proofs: [LEGACY_PROOF_1],
    });
    const emptyProofs = JSON.stringify({
      mint: "https://cashu.cz",
      proofs: [],
    });
    const mixedElements = JSON.stringify({
      mint: "https://cashu.cz",
      proofs: [LEGACY_PROOF_1, "not-a-proof"],
    });

    expect(normalizeTokenText(withoutMint)).toBeNull();
    expect(normalizeTokenText(emptyProofs)).toBeNull();
    expect(normalizeTokenText(mixedElements)).toBeNull();
    expect(normalizeTokenText("{}")).toBeNull();
  });
});

describe("extractTokenText", () => {
  const deepLinkToken = buildV3Token({
    mint: "https://mint.example",
    proofs: [{ amount: 21, secret: "secret", C: "c", id: "keyset" }],
  });

  it("extracts a scanned cashu deep link token", () => {
    expect(extractTokenText(`cashu://${deepLinkToken}`)).toBe(deepLinkToken);
    expect(extractTokenText(`web+cashu://${deepLinkToken}`)).toBe(
      deepLinkToken,
    );
  });

  it("extracts a token from wallet deeplink URLs", () => {
    expect(
      extractTokenText(`https://app.linky.fit/#wallet?cashu=${deepLinkToken}`),
    ).toBe(deepLinkToken);
    expect(
      extractTokenText(`https://app.linky.fit/cashu/${deepLinkToken}`),
    ).toBe(deepLinkToken);
  });

  it("extracts a token embedded mid-sentence", () => {
    expect(
      extractTokenText(`here is your token ${deepLinkToken} enjoy it`),
    ).toBe(deepLinkToken);
  });

  it("extracts a token broken by whitespace in the middle", () => {
    const broken = deepLinkToken.slice(0, 20) + "\n " + deepLinkToken.slice(20);

    expect(extractTokenText(broken)).toBe(deepLinkToken);
  });

  it("strips lightning and nostr prefixes", () => {
    expect(extractTokenText(`lightning:${deepLinkToken}`)).toBe(deepLinkToken);
    expect(extractTokenText(`nostr:${deepLinkToken}`)).toBe(deepLinkToken);
  });

  it("lowercases an uppercase CASHU prefix", () => {
    const payload = deepLinkToken.slice("cashuA".length);

    expect(extractTokenText(`CASHUA${payload}`)).toBe(deepLinkToken);
  });

  it("extracts a percent-encoded token", () => {
    expect(
      extractTokenText(encodeURIComponent(`cashu://${deepLinkToken}`)),
    ).toBe(deepLinkToken);
  });

  it("extracts a token from a JSON token field", () => {
    expect(extractTokenText(JSON.stringify({ token: deepLinkToken }))).toBe(
      deepLinkToken,
    );
  });

  it("extracts a legacy JSON bundle from surrounding prose", () => {
    const expected = normalizeTokenText(legacyNestedBundle);

    expect(expected).not.toBeNull();
    expect(extractTokenText(`check this ${legacyNestedBundle} out`)).toBe(
      expected,
    );
  });

  it("does not treat SPD bank payment payloads as tokens", () => {
    expect(
      extractTokenText(
        "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*MSG:Faktura",
      ),
    ).toBeNull();
  });

  it("does not treat bank payment offers as tokens", () => {
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

    expect(extractTokenText(bankOffer)).toBeNull();
  });

  it("returns null for plain text and empty input", () => {
    expect(extractTokenText("hello world")).toBeNull();
    expect(extractTokenText("")).toBeNull();
  });
});
