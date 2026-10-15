import {
  DecodedToken,
  decodePaymentRequest,
  encodeToken,
  parseBip321Uri,
} from "@linky-fit/linkshu";
import { encodeNprofile, Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createIdFromString } from "@linky-fit/domain";
import {
  buildBitcoinPaymentUri,
  buildCashuRequest,
  type IncomingCashu,
  minimumBitcoinSats,
  paymentNamedBy,
  readIncomingCashu,
} from "./bitcoin";
import { CzkAmount, czkToSats, minimumCzkFor, Sats } from "./money";
import type { Payment } from "./records";
import { VariableSymbol } from "./variableSymbol";

const mint = "http://localhost:3338";
const nprofile = encodeNprofile(Pubkey.make("a".repeat(64)), [
  "ws://localhost:7777",
]);
const invoice = "lnbc100n1fakeinvoice";

const id = (name: string) => createIdFromString<"Transaction">(name);

const payment = (
  name: string,
  overrides: { readonly mintUrl?: string; readonly bitcoin?: null } = {},
): Payment => ({
  id: id(name),
  amountCzk: CzkAmount.make(100),
  tipCzk: null,
  vs: VariableSymbol.make("1234567890"),
  status: "pending",
  method: null,
  createdAtSec: 1_000,
  paidAtSec: null,
  bitcoin:
    overrides.bitcoin === null
      ? null
      : {
          sats: Sats.make(100),
          czkPerBtc: 2_000_000,
          mintUrl: overrides.mintUrl ?? mint,
          paymentRequest: "creqA",
          quoteId: null,
          invoice: null,
        },
  cashuReceive: null,
  payerPubkey: null,
  hiddenAtSec: null,
});

const token = (
  amount: number,
  overrides: Partial<IncomingCashu> = {},
): IncomingCashu => ({
  mint,
  amount,
  unit: "sat",
  requestId: null,
  memo: null,
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
});

describe("paymentNamedBy", () => {
  const payments = [
    payment("p1"),
    payment("other-mint", { mintUrl: "https://cashu.cz" }),
    payment("bank-only", { bitcoin: null }),
  ];

  it("finds the payment a payload names by its request id, whatever its amount", () => {
    expect(paymentNamedBy(token(1, { requestId: id("p1") }), payments)).toBe(
      payments[0],
    );
  });

  it("finds none for a bare token, even one of the requested amount", () => {
    expect(paymentNamedBy(token(100), payments)).toBeNull();
  });

  it("finds none for a payload from another mint than its request's, or naming no Bitcoin request", () => {
    for (const name of ["other-mint", "bank-only", "missing"]) {
      expect(
        paymentNamedBy(token(100, { requestId: id(name) }), payments),
      ).toBeNull();
    }
  });

  it("compares mints without a trailing slash or case", () => {
    expect(
      paymentNamedBy(
        token(100, { mint: "HTTP://localhost:3338/", requestId: id("p1") }),
        payments,
      ),
    ).toBe(payments[0]);
  });

  it("ignores payloads in another unit and treats a missing unit as sat", () => {
    expect(
      paymentNamedBy(
        token(100, { unit: "usd", requestId: id("p1") }),
        payments,
      ),
    ).toBeNull();
    expect(
      paymentNamedBy(token(100, { unit: null, requestId: id("p1") }), payments),
    ).toBe(payments[0]);
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

  it("reads a bare token's mint, face value and the note Linky sends as its memo", () => {
    const text = encodeToken(
      Schema.decodeUnknownSync(DecodedToken)({
        mint,
        unit: "sat",
        memo: "Za kávu",
        proofs,
      }),
    );
    expect(readIncomingCashu(text)).toEqual({
      mint,
      amount: 100,
      unit: "sat",
      requestId: null,
      memo: "Za kávu",
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
      memo: null,
    });
  });

  it("returns null for plain chat text", () => {
    expect(readIncomingCashu("thanks for the coffee")).toBeNull();
  });
});
