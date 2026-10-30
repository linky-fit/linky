import { describe, expect, it } from "vitest";
import {
  balanceSats,
  createPayment,
  quoteWithdrawal,
  seedData,
  settlePayment,
  withdraw,
} from "./store";

const now = new Date("2026-10-14T12:00:00Z");
const empty = { payments: [], withdrawals: [], offerTips: true };

describe("the demo store", () => {
  it("settles a Cashu payment with its payer and adds its sats to the balance", () => {
    // Priced at the seed rate, as no Bitcoin leg was prepared for it.
    const opened = createPayment(empty, {
      id: "p",
      amountHalere: 11_000,
      tipHalere: 1_000,
      vs: "1",
      now,
    });
    const paid = settlePayment(
      opened,
      "p",
      { method: "cashu", payer: { name: "Jana" } },
      now,
    );
    expect(paid.payments[0]).toMatchObject({
      status: "paid",
      method: "cashu",
      tipHalere: 1_000,
      sats: 5_500,
      payer: { name: "Jana" },
    });
    expect(balanceSats(paid)).toBe(5_500);
  });

  it("keeps a bank payment out of the wallet", () => {
    const opened = createPayment(empty, {
      id: "p",
      amountHalere: 8_900,
      tipHalere: null,
      vs: "1",
      now,
    });
    const paid = settlePayment(opened, "p", { method: "bank" }, now);
    expect(paid.payments[0]).toMatchObject({ payer: null, sats: null });
    expect(balanceSats(paid)).toBe(0);
  });

  it("withdraws the whole balance with the fee deducted from it", () => {
    const data = seedData(now.getTime());
    const balance = balanceSats(data);
    const quote = quoteWithdrawal("lightning", "a@b.cz", balance);
    if (quote === "insufficient") throw new Error("expected a quote");
    expect(quote.totalSats).toBe(balance);
    expect(quote.amountSats + quote.feeSats).toBe(balance);
    expect(balanceSats(withdraw(data, quote, "w", now))).toBe(0);
    expect(quoteWithdrawal("linky", "npub1x", balance, balance + 1)).toBe(
      "insufficient",
    );
  });
});
