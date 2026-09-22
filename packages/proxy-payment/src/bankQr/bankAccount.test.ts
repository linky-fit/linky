import { describe, expect, it } from "vitest";
import {
  formatDomesticBankAccount,
  getDomesticBankAccountCountry,
  isValidBic,
  isValidIban,
  normalizeBankAccountInput,
  parseDomesticBankAccount,
} from "./bankAccount";

describe("bankAccount", () => {
  it("validates IBAN check digits", () => {
    expect(isValidIban("CZ6508000000192000145399")).toBe(true);
    expect(isValidIban("cz65 0800 0000 1920 0014 5399")).toBe(true);
    expect(isValidIban("SK9611000000002918599669")).toBe(true);
    expect(isValidIban("BE72000000001616")).toBe(true);
    expect(isValidIban("CZ6608000000192000145399")).toBe(false);
    expect(isValidIban("CZ65")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });

  it("validates BIC format", () => {
    expect(isValidBic("GIBACZPX")).toBe(true);
    expect(isValidBic("tatrskbx")).toBe(true);
    expect(isValidBic("RZBCCZPPXXX")).toBe(true);
    expect(isValidBic("GIBACZ")).toBe(false);
    expect(isValidBic("1IBACZPX")).toBe(false);
  });

  it("formats Czech and Slovak IBANs as domestic accounts", () => {
    expect(formatDomesticBankAccount("CZ6508000000192000145399")).toBe(
      "19-2000145399/0800",
    );
    expect(formatDomesticBankAccount("CZ5855000000001265098001")).toBe(
      "1265098001/5500",
    );
    expect(formatDomesticBankAccount("SK9611000000002918599669")).toBe(
      "2918599669/1100",
    );
    expect(formatDomesticBankAccount("BE72000000001616")).toBeNull();
    expect(getDomesticBankAccountCountry("SK9611000000002918599669")).toBe(
      "SK",
    );
    expect(getDomesticBankAccountCountry("BE72000000001616")).toBeNull();
  });

  it("converts domestic accounts back to IBAN with mod-11 checks", () => {
    expect(parseDomesticBankAccount("19-2000145399/0800", "CZ")).toBe(
      "CZ6508000000192000145399",
    );
    expect(parseDomesticBankAccount("2918599669/1100", "SK")).toBe(
      "SK9611000000002918599669",
    );
    expect(parseDomesticBankAccount("1234/0800", "CZ")).toBeNull();
    expect(parseDomesticBankAccount("18-2000145399/0800", "CZ")).toBeNull();
    expect(parseDomesticBankAccount("2000145399/800", "CZ")).toBeNull();
  });

  it("normalizes either notation to an IBAN", () => {
    expect(normalizeBankAccountInput("19-2000145399/0800", "CZ")).toBe(
      "CZ6508000000192000145399",
    );
    expect(
      normalizeBankAccountInput("cz65 0800 0000 1920 0014 5399", "CZ"),
    ).toBe("CZ6508000000192000145399");
    expect(normalizeBankAccountInput("BE72000000001616", "CZ")).toBe(
      "BE72000000001616",
    );
    expect(normalizeBankAccountInput("nonsense", "CZ")).toBeNull();
  });
});
