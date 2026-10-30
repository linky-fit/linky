import { describe, expect, it } from "vitest";
import { CzechIban } from "./czechAccount";
import { CzkAmount } from "./money";
import { buildSpd } from "./spd";
import { VariableSymbol } from "./variableSymbol";

const iban = CzechIban.make("CZ5855000000001265098001");

describe("buildSpd", () => {
  it("names the recipient and asks for an instant payment, in the ČBA specification's field order", () => {
    expect(
      buildSpd({
        iban,
        amount: CzkAmount.make(48050),
        variableSymbol: VariableSymbol.make("1234567890"),
        recipientName: "Kavárna U Lípy",
      }),
    ).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*RN:Kavarna U Lipy*X-VS:1234567890*PT:IP",
    );
  });

  it("formats whole amounts with two decimals and omits empty fields", () => {
    expect(
      buildSpd({ iban, amount: CzkAmount.make(100), recipientName: " 🙂 " }),
    ).toBe("SPD*1.0*ACC:CZ5855000000001265098001*AM:1.00*CC:CZK*PT:IP");
  });

  it("escapes reserved characters", () => {
    expect(
      buildSpd({
        iban,
        amount: CzkAmount.make(5),
        recipientName: "Kafe*Bar 100% + čaj",
      }),
    ).toBe(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:0.05*CC:CZK*RN:Kafe%2ABar 100%25 %2B caj*PT:IP",
    );
  });

  it("keeps the name within 35 characters without splitting an escape", () => {
    const spd = buildSpd({
      iban,
      amount: CzkAmount.make(100),
      recipientName: `${"a".repeat(33)}*b`,
    });
    expect(spd).toContain(`RN:${"a".repeat(33)}*`);
    expect(
      buildSpd({
        iban,
        amount: CzkAmount.make(100),
        recipientName: "ž".repeat(80),
      }),
    ).toContain(`RN:${"z".repeat(35)}*`);
  });
});
