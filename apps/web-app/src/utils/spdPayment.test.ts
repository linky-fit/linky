import { describe, expect, it } from "vitest";
import { CurrencyCode, encode, PaymentOptions } from "bysquare/pay";
import {
  getBankPaymentOfferCurrency,
  isBankPaymentPayload,
  parseBankPayment,
  parseSpdPayment,
  tryParseBankPayment,
  updateBankPaymentFields,
} from "./spdPayment";

describe("spdPayment", () => {
  it("parses Czech SPD payment fields", () => {
    const payment = parseSpdPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*X-VS:1234567890*MSG:Faktura",
    );

    expect(payment.payload).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*X-VS:1234567890*MSG:Faktura",
    );
    expect(payment.fields["ACC"]).toBe("CZ5855000000001265098001");
    expect(payment.fields["AM"]).toBe("480.50");
    expect(payment.fields["CC"]).toBe("CZK");
    expect(payment.fields["X-VS"]).toBe("1234567890");
    expect(payment.fields["MSG"]).toBe("Faktura");
  });

  it("decodes percent-encoded values", () => {
    const payment = parseSpdPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001*MSG:Faktura%202026",
    );

    expect(payment.fields["MSG"]).toBe("Faktura 2026");
  });

  it("rejects SPD payments without a recipient account", () => {
    expect(() => parseSpdPayment("SPD*1.0*AM:480.50*CC:CZK")).toThrow(
      "spd-missing-account",
    );
    expect(isBankPaymentPayload("SPD*1.0*AM:480.50*CC:CZK")).toBe(true);
  });

  it("decodes Slovak PAY by square euro payments", () => {
    const payload = encode({
      invoiceId: "20260042",
      payments: [
        {
          amount: 123.45,
          bankAccounts: [{ bic: "TATRSKBX", iban: "SK9611000000002918599669" }],
          beneficiary: { name: "Dodávateľ s.r.o." },
          currencyCode: CurrencyCode.EUR,
          paymentDueDate: "20260815",
          paymentNote: "Faktúra 42",
          type: PaymentOptions.PaymentOrder,
          variableSymbol: "20260042",
        },
      ],
    });

    const payment = parseBankPayment(payload);

    expect(payment.format).toBe("bysquare");
    expect(payment.payload).toBe(payload);
    expect(payment.fields["ACC"]).toBe("SK9611000000002918599669");
    expect(payment.fields["AM"]).toBe("123.45");
    expect(payment.fields["CC"]).toBe("EUR");
    expect(payment.fields["RN"]).toBe("Dodavatel s.r.o.");
    expect(payment.fields["X-VS"]).toBe("20260042");
    expect(getBankPaymentOfferCurrency(payload)).toBe("EUR");
  });

  it("parses European Payments Council SEPA QR payments", () => {
    const payload = [
      "BCD",
      "002",
      "1",
      "SCT",
      "GIBAATWWXXX",
      "European Merchant",
      "AT611904300234573201",
      "EUR89.90",
      "GDDS",
      "RF18539007547034",
      "",
      "Invoice 42",
    ].join("\n");

    const payment = parseBankPayment(payload);

    expect(payment.format).toBe("epc");
    expect(payment.fields["ACC"]).toBe("AT611904300234573201");
    expect(payment.fields["AM"]).toBe("89.90");
    expect(payment.fields["BIC"]).toBe("GIBAATWWXXX");
    expect(payment.fields["CC"]).toBe("EUR");
    expect(payment.fields["RF"]).toBe("RF18539007547034");
    expect(getBankPaymentOfferCurrency(payload)).toBe("EUR");
  });

  it("does not classify unrelated uppercase text as a bank payment", () => {
    expect(tryParseBankPayment("THISISNOTABANKPAYMENT")).toBeNull();
    expect(
      getBankPaymentOfferCurrency("SPD*1.0*ACC:US123*AM:10*CC:USD"),
    ).toBeNull();
  });

  it("re-encodes edited SPD fields, escapes reserved characters and drops CRC32", () => {
    const payment = parseBankPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*X-VS:123*CRC32:AB12CD34",
    );

    const updated = updateBankPaymentFields(payment, {
      AM: "1 250,5",
      MSG: "Oběd *50%",
      "X-SS": "",
      "X-VS": "987",
    });

    expect(updated.format).toBe("spd");
    expect(updated.payload).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:1250.5*CC:CZK*X-VS:987*MSG:Ob%C4%9Bd %2A50%25",
    );
    expect(updated.fields["AM"]).toBe("1250.5");
    expect(updated.fields["MSG"]).toBe("Oběd *50%");
    expect(updated.fields["X-VS"]).toBe("987");
    expect(updated.fields["CRC32"]).toBeUndefined();
  });

  it("splits the BIC out of an SPD account and puts it back on edit", () => {
    const payment = parseBankPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001+RZBCCZPP*AM:480*CC:CZK",
    );
    expect(payment.fields["ACC"]).toBe("CZ5855000000001265098001");
    expect(payment.fields["BIC"]).toBe("RZBCCZPP");

    expect(updateBankPaymentFields(payment, { AM: "12" }).payload).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001+RZBCCZPP*AM:12*CC:CZK",
    );
    expect(updateBankPaymentFields(payment, { BIC: "" }).payload).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK",
    );
    expect(
      updateBankPaymentFields(payment, { BIC: "gibaczpx" }).fields["BIC"],
    ).toBe("GIBACZPX");
  });

  it("accepts Czech domestic account numbers and converts them to IBAN", () => {
    const payment = parseBankPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK",
    );

    expect(
      updateBankPaymentFields(payment, { ACC: "19-2000145399/0800" }).fields[
        "ACC"
      ],
    ).toBe("CZ6508000000192000145399");
    expect(
      updateBankPaymentFields(payment, { ACC: "sk96 1100 0000 0029 1859 9669" })
        .fields["ACC"],
    ).toBe("SK9611000000002918599669");

    const slovak = parseBankPayment(
      "SPD*1.0*ACC:SK9611000000002918599669*AM:1*CC:EUR",
    );
    expect(
      updateBankPaymentFields(slovak, { ACC: "2918599669/1100" }).fields["ACC"],
    ).toBe("SK9611000000002918599669");
  });

  it("rejects edits that remove or break the account, BIC or amount", () => {
    const payment = parseBankPayment(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK",
    );

    expect(() => updateBankPaymentFields(payment, { ACC: " " })).toThrow(
      "spd-missing-account",
    );
    expect(() =>
      updateBankPaymentFields(payment, { ACC: "1234/0800" }),
    ).toThrow("bank-payment-invalid-account");
    expect(() =>
      updateBankPaymentFields(payment, { ACC: "CZ6608000000192000145399" }),
    ).toThrow("bank-payment-invalid-account");
    expect(() => updateBankPaymentFields(payment, { BIC: "GIBA" })).toThrow(
      "bank-payment-invalid-bic",
    );
    expect(() => updateBankPaymentFields(payment, { AM: "12,345" })).toThrow(
      "bank-payment-invalid-amount",
    );
    expect(() => updateBankPaymentFields(payment, { AM: "abc" })).toThrow(
      "bank-payment-invalid-amount",
    );
  });

  it("re-encodes edited SEPA payments line by line", () => {
    const payment = parseBankPayment(
      [
        "BCD",
        "002",
        "1",
        "SCT",
        "BPOTBEB1",
        "Red Cross",
        "BE72000000001616",
        "EUR1",
        "",
        "",
        "Urgency fund",
      ].join("\n"),
    );

    const updated = updateBankPaymentFields(payment, {
      AM: "12.50",
      MSG: "Winter appeal",
      RN: "Red Cross Belgium",
    });

    expect(updated.format).toBe("epc");
    expect(updated.payload.split("\n")).toEqual([
      "BCD",
      "002",
      "1",
      "SCT",
      "BPOTBEB1",
      "Red Cross Belgium",
      "BE72000000001616",
      "EUR12.50",
      "",
      "",
      "Winter appeal",
    ]);
    expect(updated.fields["AM"]).toBe("12.50");
  });

  it("re-encodes edited PAY by square payments", () => {
    const payment = parseBankPayment(
      encode({
        invoiceId: "20260042",
        payments: [
          {
            amount: 123.45,
            bankAccounts: [
              { bic: "TATRSKBX", iban: "SK9611000000002918599669" },
            ],
            beneficiary: { name: "Dodavatel s.r.o." },
            currencyCode: CurrencyCode.EUR,
            paymentNote: "Faktura 42",
            type: PaymentOptions.PaymentOrder,
            variableSymbol: "20260042",
          },
        ],
      }),
    );

    const updated = updateBankPaymentFields(payment, {
      AM: "99,90",
      MSG: "",
      "X-SS": "0308",
      "X-VS": "20260043",
    });

    expect(updated.format).toBe("bysquare");
    expect(updated.payload).not.toBe(payment.payload);
    expect(updated.fields["ACC"]).toBe("SK9611000000002918599669");
    expect(updated.fields["BIC"]).toBe("TATRSKBX");
    expect(updated.fields["AM"]).toBe("99.9");
    expect(updated.fields["CC"]).toBe("EUR");
    expect(updated.fields["RN"]).toBe("Dodavatel s.r.o.");
    expect(updated.fields["MSG"]).toBeUndefined();
    expect(updated.fields["X-SS"]).toBe("0308");
    expect(updated.fields["X-VS"]).toBe("20260043");
  });
});
