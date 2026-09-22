import { base32hexnopad } from "@scure/base";
import {
  CurrencyCode,
  decode,
  deserialize,
  encode,
  PaymentOptions,
  serialize,
  type DataModel,
} from "bysquare/pay";
import { describe, expect, it } from "vitest";
import { isBankPaymentPayload, parseBankPayment } from "./bankPayment";

const model: DataModel = {
  payments: [
    {
      amount: 12.5,
      bankAccounts: [{ iban: "SK9611000000002918599669" }],
      beneficiary: { name: "Merchant" },
      currencyCode: CurrencyCode.EUR,
      type: PaymentOptions.PaymentOrder,
    },
  ],
};

const replaceField = (index: number, value: string): string => {
  const fields = serialize(model).split("\t");
  fields[index] = value;
  return fields.join("\t");
};

describe("PAY by square decoder resource bounds", () => {
  it.each(["-1", "0", "1.5", "2", "invalid"])(
    "rejects invalid or unsupported payment count %s before the loop",
    (count) => {
      expect(() => deserialize(replaceField(1, count))).toThrow(
        "Invalid payment count",
      );
    },
  );

  it.each(["-1", "0", "1.5", "3", "invalid"])(
    "rejects invalid or unsupported bank account count %s before the loop",
    (count) => {
      expect(() => deserialize(replaceField(11, count))).toThrow(
        "Invalid bank account count",
      );
    },
  );

  it("allows multiple complete payments and bank accounts", () => {
    const first = model.payments[0];
    if (!first) throw new Error("missing fixture payment");
    const multiple = {
      payments: [
        {
          ...first,
          bankAccounts: [...first.bankAccounts, ...first.bankAccounts],
        },
        first,
      ],
    };
    expect(decode(encode(multiple)).payments).toHaveLength(2);
    expect(decode(encode(multiple)).payments[0]?.bankAccounts).toHaveLength(2);
    expect(parseBankPayment(encode(multiple)).fields["AM"]).toBe("12.5");
  });

  it("bounds the intermediate text before splitting it into fields", () => {
    const valid = serialize(model);
    const maximum = "x".repeat(65531 - valid.length) + valid;
    expect(deserialize(maximum).payments).toHaveLength(1);
    expect(() => deserialize("x" + maximum)).toThrow(
      "PAY payload exceeds 16-bit length",
    );
  });

  it("bounds encoded input before base32 allocation", () => {
    expect(() => decode("0".repeat(4097))).toThrow(
      "PAY QR input exceeds size limit",
    );
    expect(isBankPaymentPayload("0".repeat(4097))).toBe(false);
  });

  it.each([0, 1, 2, 3])(
    "rejects declared output length %s before decompression",
    (length) => {
      const bytes = base32hexnopad.decode(encode(model));
      bytes[2] = length;
      bytes[3] = 0;
      const payload = base32hexnopad.encode(bytes);
      expect(() => decode(payload)).toThrow("Invalid PAY payload length");
      expect(isBankPaymentPayload(payload)).toBe(false);
    },
  );

  it("rejects a decompressed size that differs from the header", () => {
    const bytes = base32hexnopad.decode(encode(model));
    const view = new DataView(bytes.buffer);
    view.setUint16(2, view.getUint16(2, true) + 1, true);
    expect(() => decode(base32hexnopad.encode(bytes))).toThrow(
      "PAY payload length mismatch",
    );
  });
});
