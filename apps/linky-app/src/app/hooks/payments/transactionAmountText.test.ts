import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../../lib/transactionHistory";
import { historyAmountText, signedAmountText } from "./useTransactionHistory";

const history = {
  formatAmountText: (amount: number | null) =>
    amount === null ? "" : `~${amount} Kč`,
};
const item = (
  direction: TransactionItem["direction"],
  amount: number | null = 25,
) => ({ amount, direction, unit: "sat" });

describe("transaction amount text", () => {
  it("puts a spaced minus only before an outgoing amount in the history list", () => {
    expect(historyAmountText(history, item("out"))).toBe("− ~25 Kč");
    expect(historyAmountText(history, item("in"))).toBe("~25 Kč");
    expect(historyAmountText(history, item("out", null))).toBe("");
  });

  it("signs both directions on the detail page, apart from the approximation", () => {
    expect(signedAmountText(history, item("out"))).toBe("− ~25 Kč");
    expect(signedAmountText(history, item("in"))).toBe("+ ~25 Kč");
  });
});
