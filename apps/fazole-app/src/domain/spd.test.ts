import { describe, expect, it } from "vitest";
import { CzechIban } from "./czechAccount";
import { CzkAmount } from "./money";
import { buildSpd } from "./spd";
import { VariableSymbol } from "./variableSymbol";

const iban = CzechIban.make("CZ5855000000001265098001");

describe("buildSpd", () => {
  it("matches the ČBA specification example", () => {
    expect(
      buildSpd({
        iban,
        amount: CzkAmount.make(48050),
        variableSymbol: VariableSymbol.make("1234567890"),
        message: "Platba za elektřinu",
      }),
    ).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*X-VS:1234567890*MSG:Platba za elektrinu",
    );
  });

  it("formats whole amounts with two decimals and omits empty fields", () => {
    expect(
      buildSpd({ iban, amount: CzkAmount.make(100), message: " 🙂 " }),
    ).toBe("SPD*1.0*ACC:CZ5855000000001265098001*AM:1.00*CC:CZK");
  });

  it("escapes reserved characters", () => {
    expect(
      buildSpd({
        iban,
        amount: CzkAmount.make(5),
        message: "Kafe*Bar 100% + čaj",
      }),
    ).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:0.05*CC:CZK*MSG:Kafe%2ABar 100%25 %2B caj",
    );
  });

  it("keeps MSG within 60 characters without splitting an escape", () => {
    const spd = buildSpd({
      iban,
      amount: CzkAmount.make(100),
      message: `${"a".repeat(58)}*b`,
    });
    expect(spd.endsWith(`MSG:${"a".repeat(58)}`)).toBe(true);
    expect(
      buildSpd({ iban, amount: CzkAmount.make(100), message: "ž".repeat(80) }),
    ).toContain(`MSG:${"z".repeat(60)}`);
  });
});
