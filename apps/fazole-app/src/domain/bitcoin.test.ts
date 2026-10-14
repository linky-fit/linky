import {
  DecodedToken,
  decodePaymentRequest,
  encodeToken,
  parseBip321Uri,
} from "@linky-fit/linkshu";
import { encodeNprofile, Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildBitcoinPaymentUri,
  buildCashuRequest,
  cashuRequestMint,
  type IncomingCashu,
  isOpenBitcoinRequest,
  matchIncomingCashu,
  matchRepeatedCashu,
  minimumBitcoinSats,
  OPEN_REQUEST_SEC,
  type OpenBitcoinPayment,
  readIncomingCashu,
  requestMintElsewhere,
  uniqueRequestSats,
} from "./bitcoin";
import { CzkAmount, czkToSats, minimumCzkFor, Sats } from "./money";

const mint = "http://localhost:3338";
const nprofile = encodeNprofile(Pubkey.make("a".repeat(64)), [
  "ws://localhost:7777",
]);
const invoice = "lnbc100n1fakeinvoice";

const payment = (
  id: string,
  sats: number,
  overrides: Partial<OpenBitcoinPayment> = {},
): OpenBitcoinPayment => ({
  id,
  status: "pending",
  sats: Sats.make(sats),
  mintUrl: mint,
  createdAtSec: 1_000,
  ...overrides,
});

const token = (
  amount: number,
  overrides: Partial<IncomingCashu> = {},
): IncomingCashu => ({
  mint,
  amount,
  unit: "sat",
  requestId: null,
  ...overrides,
});

describe("buildCashuRequest", () => {
  it("asks for the sats at the shop mint over Nostr, under the payment id", () => {
    const request = buildCashuRequest({
      sats: Sats.make(2_100),
      mintUrl: mint,
      deviceNprofile: nprofile,
      paymentId: "payment-1",
    });
    expect(decodePaymentRequest(request)).toMatchObject({
      amount: 2_100,
      unit: "sat",
      singleUse: true,
      mints: [mint],
      id: "payment-1",
      transports: [{ type: "nostr", target: nprofile, tags: [["n", "17"]] }],
    });
    expect(cashuRequestMint(request)).toBe(mint);
  });

  it("puts both legs into one BIP-321 URI", () => {
    const creq = buildCashuRequest({
      sats: Sats.make(21),
      mintUrl: mint,
      deviceNprofile: nprofile,
      paymentId: "payment-1",
    });
    const uri = buildBitcoinPaymentUri(invoice, creq);
    expect(uri.startsWith("bitcoin:?")).toBe(true);
    expect(parseBip321Uri(uri)).toMatchObject({ lightning: invoice, creq });
  });

  it("reads no mint from text that is not a request", () => {
    expect(cashuRequestMint("cashuBnope")).toBeNull();
  });
});

describe("matchIncomingCashu", () => {
  it("matches a payload by its request id, even after a cancel", () => {
    const cancelled = payment("p1", 100, { status: "cancelled" });
    expect(
      matchIncomingCashu(token(100, { requestId: "p1" }), [
        cancelled,
        payment("p2", 100, { createdAtSec: 2_000 }),
      ]),
    ).toBe(cancelled);
  });

  it("refuses a payload whose request is paid, at another mint or short", () => {
    const payments = [
      payment("paid", 100, { status: "paid" }),
      payment("other-mint", 100, { mintUrl: "https://cashu.cz" }),
      payment("short", 100),
    ];
    for (const requestId of ["paid", "other-mint", "missing"]) {
      expect(
        matchIncomingCashu(token(100, { requestId }), payments),
      ).toBeNull();
    }
    expect(
      matchIncomingCashu(token(99, { requestId: "short" }), payments),
    ).toBeNull();
  });

  it("matches a bare token to the one request asking exactly its amount, even a cancelled one", () => {
    const payments = [
      payment("small", 50),
      payment("cancelled", 100, { status: "cancelled" }),
      payment("paid", 120, { status: "paid" }),
      payment("other-mint", 120, { mintUrl: "https://cashu.cz" }),
    ];
    expect(matchIncomingCashu(token(100), payments)?.id).toBe("cancelled");
    expect(matchIncomingCashu(token(50), payments)?.id).toBe("small");
    expect(matchIncomingCashu(token(60), payments)).toBeNull();
    expect(matchIncomingCashu(token(120), payments)).toBeNull();
  });

  it("assigns a bare token to no request when two ask its amount", () => {
    const payments = [payment("first", 587), payment("second", 587)];
    expect(matchIncomingCashu(token(587), payments)).toBeNull();
    expect(
      matchIncomingCashu(token(587, { requestId: "first" }), payments)?.id,
    ).toBe("first");
  });

  it("names the mint of the request a token from another mint would pay there", () => {
    const linkyMint = "https://mint.minibits.cash/Bitcoin";
    const payments = [
      payment("p1", 100),
      payment("cancelled", 120, { status: "cancelled" }),
    ];
    expect(
      requestMintElsewhere(token(100, { mint: linkyMint }), payments),
    ).toBe(mint);
    expect(
      requestMintElsewhere(
        token(100, { mint: linkyMint, requestId: "cancelled" }),
        payments,
      ),
    ).toBeNull();
    expect(
      requestMintElsewhere(token(120, { mint: linkyMint }), payments),
    ).toBe(mint);
    expect(
      requestMintElsewhere(token(60, { mint: linkyMint }), payments),
    ).toBeNull();
    expect(requestMintElsewhere(token(100), payments)).toBeNull();
  });

  it("compares mints without a trailing slash or case", () => {
    expect(
      matchIncomingCashu(token(100, { mint: "HTTP://localhost:3338/" }), [
        payment("p1", 100),
      ])?.id,
    ).toBe("p1");
  });

  it("ignores tokens in another unit and treats a missing unit as sat", () => {
    const payments = [payment("p1", 100)];
    expect(
      matchIncomingCashu(token(100, { unit: "usd" }), payments),
    ).toBeNull();
    expect(matchIncomingCashu(token(100, { unit: null }), payments)?.id).toBe(
      "p1",
    );
  });
});

describe("matchRepeatedCashu", () => {
  it("matches a further token only to a paid request", () => {
    const payments = [
      payment("paid", 100, { status: "paid" }),
      payment("open", 120),
    ];
    expect(matchRepeatedCashu(token(100), payments)?.id).toBe("paid");
    expect(
      matchRepeatedCashu(token(100, { requestId: "paid" }), payments)?.id,
    ).toBe("paid");
    expect(matchRepeatedCashu(token(120), payments)).toBeNull();
  });
});

describe("uniqueRequestSats", () => {
  it("raises the amount a sat at a time past every amount an open request asks", () => {
    const open = [payment("a", 587), payment("b", 588), payment("c", 600)];
    expect(uniqueRequestSats(Sats.make(587), open)).toBe(589);
    expect(uniqueRequestSats(Sats.make(590), open)).toBe(590);
  });

  it("keeps two same-CZK requests apart, so paying the older one settles it", () => {
    const sats = czkToSats(CzkAmount.make(1_100), 1_875_000);
    const older = payment("older", uniqueRequestSats(sats, []));
    const newer = payment("newer", uniqueRequestSats(sats, [older]));
    expect(newer.sats).toBe(older.sats + 1);
    expect(matchIncomingCashu(token(older.sats), [older, newer])?.id).toBe(
      "older",
    );
  });
});

describe("isOpenBitcoinRequest", () => {
  it("keeps unpaid requests, also cancelled ones, for a day", () => {
    const now = 10 * OPEN_REQUEST_SEC;
    const at = (status: "pending" | "cancelled" | "paid", ageSec: number) =>
      isOpenBitcoinRequest({ status, createdAtSec: now - ageSec }, now);
    expect(at("pending", 1)).toBe(true);
    expect(at("cancelled", OPEN_REQUEST_SEC - 1)).toBe(true);
    expect(at("paid", 1)).toBe(false);
    expect(at("pending", OPEN_REQUEST_SEC)).toBe(false);
  });
});

describe("minimumBitcoinSats", () => {
  it("is a floor of 10 sat, scaled for mints charging over a sat per proof", () => {
    expect(minimumBitcoinSats(null)).toBe(10);
    expect(minimumBitcoinSats(100)).toBe(10);
    expect(minimumBitcoinSats(1_000)).toBe(10);
    expect(minimumBitcoinSats(2_500)).toBe(30);
  });

  it("names the smallest amount that reaches the minimum", () => {
    const rate = 2_300_000;
    const from = minimumCzkFor(minimumBitcoinSats(100), rate);
    expect(from).toBe(21);
    expect(czkToSats(from, rate)).toBe(10);
    expect(czkToSats(CzkAmount.make(from - 1), rate)).toBe(9);
  });
});

describe("readIncomingCashu", () => {
  const proofs = [
    {
      id: "00ad268c4d1f5826",
      amount: 64,
      secret: "s1",
      C: "02".padEnd(66, "a"),
    },
    {
      id: "00ad268c4d1f5826",
      amount: 36,
      secret: "s2",
      C: "02".padEnd(66, "b"),
    },
  ];

  it("reads a bare token's mint and face value", () => {
    const text = encodeToken(
      Schema.decodeUnknownSync(DecodedToken)({
        mint,
        unit: "sat",
        memo: null,
        proofs,
      }),
    );
    expect(readIncomingCashu(text)).toEqual({
      mint,
      amount: 100,
      unit: "sat",
      requestId: null,
    });
    expect(readIncomingCashu(`cashu:${text}`)?.amount).toBe(100);
  });

  it("reads the request id a NUT-18 payload echoes", () => {
    const payload = JSON.stringify({ id: "p1", mint, unit: "sat", proofs });
    expect(readIncomingCashu(payload)).toEqual({
      mint,
      amount: 100,
      unit: "sat",
      requestId: "p1",
    });
  });

  it("returns null for plain chat text", () => {
    expect(readIncomingCashu("thanks for the coffee")).toBeNull();
  });
});
