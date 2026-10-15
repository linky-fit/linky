import { createIdFromString } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { balanceChange, parseSats, walletActivity } from "./activity";
import { CzkAmount, Sats } from "./money";
import type { DirectTransfer, Payment, Receipt, Withdrawal } from "./records";
import { VariableSymbol } from "./variableSymbol";

const id = (name: string) => createIdFromString<"Transaction">(name);

const leg = {
  sats: Sats.make(100),
  czkPerBtc: 2_500_000,
  mintUrl: "http://localhost:3338",
  paymentRequest: "creqA",
  quoteId: "quote",
  invoice: "lnbc",
};

const payment = (name: string, overrides: Partial<Payment>): Payment => ({
  id: id(name),
  amountCzk: CzkAmount.make(2_500),
  vs: VariableSymbol.make("1234567890"),
  status: "paid",
  method: "lightning",
  createdAtSec: 1_000,
  paidAtSec: 1_000,
  bitcoin: leg,
  cashuReceive: null,
  tipCzk: null,
  payerPubkey: null,
  hiddenAtSec: null,
  ...overrides,
});

const withdrawal = (
  name: string,
  overrides: Partial<Withdrawal>,
): Withdrawal => ({
  id: id(name),
  kind: "cashu_chat",
  status: "pending",
  target: "npub1test",
  amountSats: 40,
  feeSats: null,
  createdAtSec: 1_000,
  mintUrl: "http://localhost:3338",
  quoteId: null,
  invoice: null,
  operationId: null,
  error: null,
  ...overrides,
});

const receipt = (name: string, overrides: Partial<Receipt>): Receipt => ({
  id: id(name),
  method: "cashu",
  sats: 99,
  receivedAtSec: 1_000,
  operationId: `receive-${name}`,
  paymentId: null,
  ...overrides,
});

const direct = (
  name: string,
  overrides: Partial<DirectTransfer>,
): DirectTransfer => ({
  id: id(name),
  sats: 300,
  czkPerBtc: null,
  receivedAtSec: 1_000,
  operationId: `receive-${name}`,
  mintUrl: "http://localhost:3338",
  payerPubkey: makeIdentity().pubkey,
  note: "Za kávu",
  hiddenAtSec: null,
  ...overrides,
});

describe("walletActivity", () => {
  it("lists what reached and left the wallet, newest first", () => {
    const items = walletActivity({
      payments: [
        payment("Lightning", { paidAtSec: 3_000 }),
        payment("Cashu", {
          method: "cashu",
          paidAtSec: 2_000,
          cashuReceive: { operationId: "receive-1", sats: 98 },
        }),
        payment("Bank", { method: "bank", bitcoin: null }),
        payment("Pending", { status: "pending", method: null }),
      ],
      receipts: [
        receipt("Again", { receivedAtSec: 1_500, paymentId: id("Cashu") }),
      ],
      directTransfers: [direct("Direct", { receivedAtSec: 1_200 })],
      withdrawals: [withdrawal("Out", { createdAtSec: 4_000, feeSats: 2 })],
    });
    expect(items.map((item) => [item.kind, item.sats, item.feeSats])).toEqual([
      ["withdrawal", 42, 2],
      ["payment", 100, 0],
      ["payment", 98, 2],
      ["receipt", 99, 0],
      ["direct", 300, 0],
    ]);
  });

  it("adds up to the balance the movements left", () => {
    const items = walletActivity({
      payments: [
        payment("Paid", { bitcoin: { ...leg, sats: Sats.make(500) } }),
      ],
      receipts: [receipt("Again", { sats: 249, paymentId: id("Paid") })],
      directTransfers: [direct("Direct", { sats: 300 })],
      withdrawals: [
        withdrawal("Linky", { amountSats: 100, feeSats: 1 }),
        withdrawal("Ln", {
          kind: "lightning_invoice",
          amountSats: 533,
          feeSats: 2,
          status: "done",
        }),
        withdrawal("Failed", { amountSats: 50, status: "failed" }),
      ],
    });
    expect(items.reduce((sum, item) => sum + balanceChange(item), 0)).toBe(
      500 + 249 + 300 - 101 - 535,
    );
  });

  it("keeps only the newest items", () => {
    const payments = [1, 2, 3].map((n) =>
      payment(`P${n}`, { paidAtSec: n * 1_000 }),
    );
    expect(
      walletActivity(
        { payments, receipts: [], directTransfers: [], withdrawals: [] },
        2,
      ).map((item) => item.atSec),
    ).toEqual([3_000, 2_000]);
  });
});

describe("parseSats", () => {
  it.each([
    ["1000", 1_000],
    [" 1 000 ", 1_000],
    ["0", null],
    ["12.5", null],
    ["-5", null],
    ["", null],
    ["abc", null],
  ])("%j is %j", (text, sats) => {
    expect(parseSats(text)).toBe(sats);
  });
});
