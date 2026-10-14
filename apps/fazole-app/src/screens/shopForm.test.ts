import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { checkAccount, formatIban, looksComplete } from "./shopForm";

describe("the shop form's bank account", () => {
  it("is optional", () => {
    expect(checkAccount("  ")).toEqual({ kind: "empty" });
  });

  it("shows the bank and the grouped IBAN of a valid account", () => {
    expect(checkAccount("19-2000145399/0800")).toEqual({
      kind: "valid",
      iban: "CZ6508000000192000145399",
      description: "Česká spořitelna, a.s. · CZ65 0800 0000 1920 0014 5399",
    });
  });

  it("explains a malformed account, a typo and an unknown bank", () => {
    expect(checkAccount("2000145399")).toEqual({
      kind: "invalid",
      error: copy.shopFields.accountInvalidFormat,
    });
    expect(checkAccount("2000145398/0800")).toEqual({
      kind: "invalid",
      error: copy.shopFields.accountInvalidChecksum,
    });
    expect(checkAccount("2000145399/0001")).toEqual({
      kind: "invalid",
      error: copy.shopFields.accountUnknownBank,
    });
  });

  it("counts an account as complete once its bank code is typed", () => {
    expect(looksComplete("2000145399/08")).toBe(false);
    expect(looksComplete("2000145399/0800 ")).toBe(true);
  });

  it("groups an IBAN by four", () => {
    expect(formatIban("CZ6508000000192000145399")).toBe(
      "CZ65 0800 0000 1920 0014 5399",
    );
  });
});
