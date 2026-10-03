import { describe, expect, it } from "vitest";
import { CurrencyCode, encode, PaymentOptions } from "bysquare/pay";
import {
  createBlankBankPayment,
  getBankPaymentOfferCurrency,
  isBankPaymentPayload,
  parseBankPayment,
  parseSpdPayment,
  tryParseBankPayment,
  updateBankPaymentFields,
} from "./bankPayment";

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

  it("parses payme.sk version 2 links with Slovak payment symbols", () => {
    const payload =
      "https://payme.sk/2/e/PME?IBAN=SK6807200002891987426353&AM=200.30&CC=EUR&PI=%2FVS2546874464%2FSS2019568456%2FKS1118&CN=The+Best+e-shops+ltd&MSG=my+e-shop,+Kosice";

    const payment = parseBankPayment(payload);

    expect(payment.format).toBe("payme");
    expect(payment.payload).toBe(payload);
    expect(payment.fields).toEqual({
      ACC: "SK6807200002891987426353",
      AM: "200.30",
      CC: "EUR",
      MSG: "my e-shop, Kosice",
      RN: "The Best e-shops ltd",
      "X-KS": "1118",
      "X-SS": "2019568456",
      "X-VS": "2546874464",
    });
    expect(isBankPaymentPayload(payload)).toBe(true);
    expect(getBankPaymentOfferCurrency(payload)).toBe("EUR");
  });

  it("keeps a free-form payme reference, defaults the currency and accepts %20 and odd case", () => {
    const payment = parseBankPayment(
      "HTTPS://PAYME.SK/2/M/PME?IBAN=sk68%200720%200002%208919%208742%206353&AM=5&PI=QR-ab29e346f1d841c8a95a63d857490818&CN=The%20Best%20Cafes%20ltd&MSG=Cafe%20on%20the%20corner",
    );

    expect(payment.format).toBe("payme");
    expect(payment.fields["ACC"]).toBe("SK6807200002891987426353");
    expect(payment.fields["CC"]).toBe("EUR");
    expect(payment.fields["RF"]).toBe("QR-ab29e346f1d841c8a95a63d857490818");
    expect(payment.fields["RN"]).toBe("The Best Cafes ltd");
    expect(payment.fields["MSG"]).toBe("Cafe on the corner");
    expect(payment.fields["X-VS"]).toBeUndefined();
  });

  it("parses payme.sk version 1 links", () => {
    const payment = parseBankPayment(
      "https://www.payme.sk?V=1&IBAN=SK6807200002891987426353&AM=200.30&CC=EUR&DT=20201205&PI=%2FVS2546874464%2FSS2019568456%2FKS1118&MSG=Thank+you+for+lunch.&CN=Alice+Payee",
    );

    expect(payment.format).toBe("payme");
    expect(payment.fields["ACC"]).toBe("SK6807200002891987426353");
    expect(payment.fields["AM"]).toBe("200.30");
    expect(payment.fields["DT"]).toBe("20201205");
    expect(payment.fields["MSG"]).toBe("Thank you for lunch.");
    expect(payment.fields["RN"]).toBe("Alice Payee");
    expect(payment.fields["X-VS"]).toBe("2546874464");
  });

  it("rejects payme links that are not payment links or carry bad data", () => {
    expect(tryParseBankPayment("https://payme.sk/")).toBeNull();
    expect(isBankPaymentPayload("https://payme.sk/spoznajte-payme")).toBe(
      false,
    );
    expect(
      tryParseBankPayment(
        "https://payme.sk/3/p/PME?IBAN=SK6807200002891987426353&CN=A",
      ),
    ).toBeNull();
    expect(
      tryParseBankPayment(
        "https://example.com/2/p/PME?IBAN=SK6807200002891987426353&CN=A",
      ),
    ).toBeNull();
    expect(() =>
      parseBankPayment("https://payme.sk/2/p/PME?CN=Alice+Payee&AM=1"),
    ).toThrow("spd-missing-account");
    expect(() =>
      parseBankPayment(
        "https://payme.sk/2/p/PME?IBAN=SK6807200002891987426353&AM=1,5&CN=A",
      ),
    ).toThrow("bank-payment-invalid-amount");
    expect(
      getBankPaymentOfferCurrency(
        "https://payme.sk/2/p/PME?IBAN=SK6807200002891987426353&AM=1&CC=USD&CN=A",
      ),
    ).toBeNull();
  });

  it("re-encodes edited payme links in place", () => {
    const payment = parseBankPayment(
      "https://payme.sk/2/p/PME?IBAN=SK6807200002891987426353&AM=8.59&CC=EUR&DT=20280430&MSG=Thank+you+for+lunch&CN=Alice+Payee",
    );

    const updated = updateBankPaymentFields(payment, {
      AM: "12,5",
      MSG: "Lunch & coffee",
      "X-VS": "123",
    });

    expect(updated.format).toBe("payme");
    expect(updated.payload).toBe(
      "https://payme.sk/2/p/PME?IBAN=SK6807200002891987426353&AM=12.5&CC=EUR&DT=20280430&PI=%2FVS123%2FSS%2FKS&MSG=Lunch+%26+coffee&CN=Alice+Payee",
    );
    expect(updated.fields["AM"]).toBe("12.5");
    expect(updated.fields["MSG"]).toBe("Lunch & coffee");
    expect(updated.fields["X-VS"]).toBe("123");
    expect(updated.fields["X-SS"]).toBeUndefined();

    const withReference = updateBankPaymentFields(updated, {
      RF: "INV-42",
      "X-VS": "",
    });
    expect(withReference.payload).toContain("&PI=INV-42&");
    expect(withReference.fields["RF"]).toBe("INV-42");

    expect(() =>
      updateBankPaymentFields(withReference, { "X-KS": "0308" }),
    ).toThrow("bank-payment-invalid-reference");
    expect(() => updateBankPaymentFields(payment, { ACC: "" })).toThrow(
      "spd-missing-account",
    );
  });

  it("keeps the version 1 marker when re-encoding", () => {
    const payment = parseBankPayment(
      "https://www.payme.sk?V=1&IBAN=SK6807200002891987426353&CN=Alice+Payee",
    );

    expect(updateBankPaymentFields(payment, { AM: "3" }).payload).toBe(
      "https://www.payme.sk/?V=1&IBAN=SK6807200002891987426353&AM=3&CC=EUR&CN=Alice+Payee",
    );
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

// Payloads follow the Pix "BR Code" layout (EMV tags, CRC-16/CCITT-FALSE).
const PIX_STATIC =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000520400005303986540510.005802BR5913Fulano de Tal6008BRASILIA62070503***6304288F";
const PIX_WITH_DESCRIPTION =
  "00020101021126600014br.gov.bcb.pix0120alice@exemplo.com.br0214Almoco de hoje52040000530398654071234.565802BR5913Alice Pereira6009SAO PAULO62110507ALM2026630447DC";
const PIX_DYNAMIC =
  "00020101021226600014br.gov.bcb.pix2538qr.exemplo.com.br/pix/v2/cobv/9d36b84f520400005303986540541.005802BR5917Padaria do Centro6009SAO PAULO62070503***6304D0CD";
const PIX_NO_AMOUNT =
  "00020126360014br.gov.bcb.pix0114+55119999988885204000053039865802BR5903Bob6003RIO62070503***6304CB10";
const PIX_USD =
  "00020126360014br.gov.bcb.pix0114+551199999888852040000530384054045.005802BR5903Bob6003RIO62070503***6304D462";

describe("pixPayment", () => {
  it("parses a static Pix code with a random key", () => {
    const payment = parseBankPayment(PIX_STATIC);

    expect(payment.format).toBe("pix");
    expect(payment.payload).toBe(PIX_STATIC);
    expect(payment.fields).toEqual({
      ACC: "123e4567-e12b-12d1-a456-426655440000",
      AM: "10.00",
      CC: "BRL",
      CITY: "BRASILIA",
      RN: "Fulano de Tal",
    });
    expect(isBankPaymentPayload(PIX_STATIC)).toBe(true);
    expect(getBankPaymentOfferCurrency(PIX_STATIC)).toBe("BRL");
  });

  it("reads the description, the txid and an e-mail key", () => {
    const payment = parseBankPayment(PIX_WITH_DESCRIPTION);

    expect(payment.fields).toEqual({
      ACC: "alice@exemplo.com.br",
      AM: "1234.56",
      CC: "BRL",
      CITY: "SAO PAULO",
      MSG: "Almoco de hoje",
      RF: "ALM2026",
      RN: "Alice Pereira",
    });
  });

  it("exposes the payload URL of a dynamic Pix as the account", () => {
    const payment = parseBankPayment(PIX_DYNAMIC);

    expect(payment.fields["ACC"]).toBe(
      "qr.exemplo.com.br/pix/v2/cobv/9d36b84f",
    );
    expect(payment.fields["AM"]).toBe("41.00");
    expect(payment.fields["RN"]).toBe("Padaria do Centro");
    expect(payment.fields["RF"]).toBeUndefined();
  });

  it("accepts a code without an amount and keeps the phone key", () => {
    const payment = parseBankPayment(PIX_NO_AMOUNT);

    expect(payment.fields["ACC"]).toBe("+5511999998888");
    expect(payment.fields["AM"]).toBeUndefined();
    expect(payment.fields["CC"]).toBe("BRL");
  });

  it("rejects a wrong CRC, a foreign currency, a missing key and malformed tags", () => {
    const wrongCrc = `${PIX_STATIC.slice(0, -4)}0000`;
    expect(() => parseBankPayment(wrongCrc)).toThrow(
      "bank-payment-invalid-pix-crc",
    );
    expect(isBankPaymentPayload(wrongCrc)).toBe(false);
    expect(() => parseBankPayment(PIX_USD)).toThrow("bank-payment-invalid-pix");
    expect(() =>
      parseBankPayment(
        "00020126180014br.gov.bcb.pix52040000530398658 02BR5903Bob6003RIO62070503***6304AAAA",
      ),
    ).toThrow("bank-payment-invalid-pix");
    expect(
      tryParseBankPayment("000201 some text mentioning br.gov.bcb.pix"),
    ).toBeNull();
    expect(getBankPaymentOfferCurrency(PIX_USD)).toBeNull();
  });

  it("re-encodes edits with fresh lengths and CRC, cents and a txid", () => {
    const payment = parseBankPayment(PIX_STATIC);

    const updated = updateBankPaymentFields(payment, {
      AM: "12,5",
      MSG: "Café & bolo",
      RF: "FAT42",
      RN: "João da Silva",
    });

    expect(updated.format).toBe("pix");
    expect(updated.payload).toBe(
      "00020126730014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400000211Cafe & bolo520400005303986540512.505802BR5913Joao da Silva6008BRASILIA62090505FAT426304F8A7",
    );
    expect(updated.fields).toEqual({
      ACC: "123e4567-e12b-12d1-a456-426655440000",
      AM: "12.50",
      CC: "BRL",
      CITY: "BRASILIA",
      MSG: "Cafe & bolo",
      RF: "FAT42",
      RN: "Joao da Silva",
    });
  });

  it("keeps a dynamic Pix URL in its own subtag and drops a cleared amount", () => {
    const payment = parseBankPayment(PIX_DYNAMIC);

    const updated = updateBankPaymentFields(payment, {
      ACC: "qr.exemplo.com.br/pix/v2/cobv/outro",
      AM: "",
    });

    expect(updated.payload).toBe(
      "00020101021226570014br.gov.bcb.pix2535qr.exemplo.com.br/pix/v2/cobv/outro5204000053039865802BR5917Padaria do Centro6009SAO PAULO62070503***63042AE6",
    );
    expect(updated.fields["ACC"]).toBe("qr.exemplo.com.br/pix/v2/cobv/outro");
    expect(updated.fields["AM"]).toBeUndefined();
  });

  it("builds a Pix code from a blank manual entry once key, name and city are typed", () => {
    const blank = createBlankBankPayment("BRL");
    expect(blank.format).toBe("pix");
    expect(tryParseBankPayment(blank.payload)).toBeNull();
    expect(() => updateBankPaymentFields(blank, { AM: "10" })).toThrow(
      "bank-payment-invalid-recipient",
    );
    expect(() =>
      updateBankPaymentFields(blank, { AM: "10", RN: "Bob" }),
    ).toThrow("bank-payment-invalid-city");
    expect(() =>
      updateBankPaymentFields(blank, {
        AM: "10",
        CITY: "A city name that is too long",
        RN: "Bob",
      }),
    ).toThrow("bank-payment-invalid-city");

    const filled = updateBankPaymentFields(blank, {
      ACC: "+5511999998888",
      AM: "45",
      CITY: "Rio",
      RN: "Bob",
    });
    expect(filled.payload).toContain("540545.005802BR5903Bob6003Rio6207");
    expect(parseBankPayment(filled.payload).fields).toEqual(filled.fields);
    expect(filled.fields).toEqual({
      ACC: "+5511999998888",
      AM: "45.00",
      CC: "BRL",
      CITY: "Rio",
      RN: "Bob",
    });
    expect(createBlankBankPayment("EUR")).toEqual({
      fields: { CC: "EUR" },
      format: "spd",
      payload: "SPD*1.0*CC:EUR",
    });
  });

  it("rejects edits a Pix code cannot carry", () => {
    const payment = parseBankPayment(PIX_STATIC);

    expect(() => updateBankPaymentFields(payment, { RN: "" })).toThrow(
      "bank-payment-invalid-recipient",
    );
    expect(() =>
      updateBankPaymentFields(payment, {
        RN: "A name that is far too long for Pix",
      }),
    ).toThrow("bank-payment-invalid-recipient");
    expect(() => updateBankPaymentFields(payment, { RF: "FAT-42" })).toThrow(
      "bank-payment-invalid-reference",
    );
    expect(() => updateBankPaymentFields(payment, { MSG: "Ação ✓" })).toThrow(
      "bank-payment-invalid-message",
    );
    expect(() =>
      updateBankPaymentFields(payment, { MSG: "x".repeat(60) }),
    ).toThrow("bank-payment-invalid-pix");
    expect(() => updateBankPaymentFields(payment, { ACC: "a b" })).toThrow(
      "bank-payment-invalid-account",
    );
    expect(() => updateBankPaymentFields(payment, { ACC: "" })).toThrow(
      "spd-missing-account",
    );
    expect(() => updateBankPaymentFields(payment, { AM: "1.234" })).toThrow(
      "bank-payment-invalid-amount",
    );
  });
});
