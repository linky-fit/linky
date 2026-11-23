import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { getLightningInvoicePreview } from "../index";
import { parseBolt11AmountMsat } from "./preview";

const BOLT11_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const DESCRIPTION_TAG = BOLT11_CHARSET.indexOf("d");
const EXPIRY_TAG = BOLT11_CHARSET.indexOf("x");

const encodeNumberToWords = (value: number, minLength = 0): number[] => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("value must be a non-negative integer");
  }

  const words: number[] = [];
  let remaining = value;
  do {
    words.unshift(remaining % 32);
    remaining = Math.floor(remaining / 32);
  } while (remaining > 0);

  while (words.length < minLength) words.unshift(0);
  return words;
};

const encodeTaggedField = (tag: number, dataWords: number[]): number[] => {
  return [tag, ...encodeNumberToWords(dataWords.length, 2), ...dataWords];
};

const buildLightningInvoice = (args: {
  amountHrp?: string;
  description?: string;
  expirySeconds?: number;
  timestampSec: number;
}): string => {
  const fields: number[] = [];

  if (args.description) {
    fields.push(
      ...encodeTaggedField(
        DESCRIPTION_TAG,
        bech32.toWords(new TextEncoder().encode(args.description)),
      ),
    );
  }

  if (args.expirySeconds !== undefined) {
    fields.push(
      ...encodeTaggedField(EXPIRY_TAG, encodeNumberToWords(args.expirySeconds)),
    );
  }

  const words = [
    ...encodeNumberToWords(args.timestampSec, 7),
    ...fields,
    ...new Array<number>(104).fill(0),
  ];

  return bech32.encode(`lnbc${args.amountHrp ?? ""}`, words, 5_000);
};

describe("getLightningInvoicePreview", () => {
  it("reads amount, description, and explicit expiry", () => {
    const invoice = buildLightningInvoice({
      amountHrp: "25u",
      description: "Coffee beans",
      expirySeconds: 7200,
      timestampSec: 1_700_000_000,
    });

    expect(getLightningInvoicePreview(invoice)).toEqual({
      amountSat: 2500,
      description: "Coffee beans",
      expiresAtSec: 1_700_007_200,
      invoice,
    });
  });

  it("falls back to default one-hour expiry and handles amountless invoices", () => {
    const invoice = buildLightningInvoice({
      description: "Amountless lunch",
      timestampSec: 1_700_000_000,
    });

    expect(getLightningInvoicePreview(invoice)).toEqual({
      amountSat: null,
      description: "Amountless lunch",
      expiresAtSec: 1_700_003_600,
      invoice,
    });
  });
});

describe("parseBolt11AmountMsat", () => {
  it("handles large pico-BTC amounts without IEEE-754 rounding", () => {
    expect(parseBolt11AmountMsat("lnbc9999999999999999p1test")).toBeNull();
    expect(parseBolt11AmountMsat("lnbc20000000000000010p1test")).toBe(
      2_000_000_000_000_001,
    );
    expect(parseBolt11AmountMsat("lnbcrt10n1test")).toBe(1000);
  });
});
