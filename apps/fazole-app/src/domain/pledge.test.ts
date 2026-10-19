import { createIdFromString } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { CzkAmount, Sats } from "./money";
import {
  exchangeRequestMessage,
  FORWARD_RETRY_SEC,
  isPledgeSettled,
  planForward,
  pledgeOpenedMessage,
  pledgeRemainingCzk,
  pledgeRepaidCzk,
  pledgeRepaymentMessage,
  repaymentCzkFor,
  unforwardedInflows,
  type Pledge,
} from "./pledge";
import type { DirectTransfer, Payment, Withdrawal } from "./records";
import { VariableSymbol } from "./variableSymbol";

const id = (name: string) => createIdFromString<"Transaction">(name);
const czk = (haler: number) => CzkAmount.make(haler);
// 2 500 000 Kč per BTC: a sat is 2,5 haléře, 100 Kč is 4 000 sat.
const rate = 2_500_000;

const pledge: Pledge = {
  pubkey: makeIdentity().pubkey,
  address: "hynek@linky.fit",
  amountCzk: czk(10_000),
  createdAtSec: 1_000,
};

const withdrawal = (
  name: string,
  overrides: Partial<Withdrawal>,
): Withdrawal => ({
  id: id(name),
  kind: "cashu_chat",
  status: "pending",
  target: "npub1test",
  amountSats: 1_000,
  feeSats: 2,
  createdAtSec: 1_100,
  mintUrl: "http://localhost:3338",
  quoteId: null,
  invoice: null,
  operationId: null,
  error: null,
  pledge: { czk: czk(2_500), sources: [] },
  ...overrides,
});

const direct = (
  name: string,
  overrides: Partial<DirectTransfer>,
): DirectTransfer => ({
  id: id(name),
  sats: 1_000,
  czkPerBtc: rate,
  receivedAtSec: 1_200,
  operationId: `receive-${name}`,
  mintUrl: "http://localhost:3338",
  payerPubkey: makeIdentity().pubkey,
  note: null,
  hiddenAtSec: null,
  ...overrides,
});

const payment = (name: string, overrides: Partial<Payment>): Payment => ({
  id: id(name),
  amountCzk: czk(2_500),
  vs: VariableSymbol.make("1234567890"),
  status: "paid",
  method: "lightning",
  createdAtSec: 900,
  paidAtSec: 1_300,
  bitcoin: {
    sats: Sats.make(100),
    czkPerBtc: rate,
    mintUrl: "http://localhost:3338",
    paymentRequest: "creqA",
    quoteId: "quote",
    invoice: "lnbc",
  },
  cashuReceive: null,
  tipCzk: null,
  payerPubkey: null,
  hiddenAtSec: null,
  ...overrides,
});

const records = (overrides: {
  payments?: Payment[];
  directTransfers?: DirectTransfer[];
  withdrawals?: Withdrawal[];
}) => ({
  payments: overrides.payments ?? [],
  receipts: [],
  directTransfers: overrides.directTransfers ?? [],
  withdrawals: overrides.withdrawals ?? [],
});

describe("what a pledge still owes", () => {
  it("counts pending and done repayments since the pledge, never failed or older ones", () => {
    const withdrawals = [
      withdrawal("pending", {}),
      withdrawal("done", { status: "done" }),
      withdrawal("failed", { status: "failed" }),
      withdrawal("older", { createdAtSec: 900 }),
      withdrawal("manual", { pledge: null }),
    ];
    expect(pledgeRepaidCzk(pledge, withdrawals)).toBe(5_000);
    expect(pledgeRemainingCzk(pledge, withdrawals)).toBe(5_000);
    expect(isPledgeSettled(pledge, withdrawals)).toBe(false);
  });

  it("is settled once it is repaid and every repayment reached the relay", () => {
    const repaid = [
      withdrawal("a", {
        status: "done",
        pledge: { czk: czk(6_000), sources: [] },
      }),
      withdrawal("b", { pledge: { czk: czk(4_000), sources: [] } }),
    ];
    expect(pledgeRemainingCzk(pledge, repaid)).toBe(0);
    expect(isPledgeSettled(pledge, repaid)).toBe(false);
    expect(
      isPledgeSettled(pledge, [repaid[0]!, { ...repaid[1]!, status: "done" }]),
    ).toBe(true);
  });

  it("never owes less than nothing when repayments overshoot", () => {
    expect(
      pledgeRemainingCzk(pledge, [
        withdrawal("a", { pledge: { czk: czk(12_000), sources: [] } }),
      ]),
    ).toBe(0);
  });
});

describe("unforwardedInflows", () => {
  it("lists inflows since the pledge no live repayment forwarded, oldest first", () => {
    const inflows = unforwardedInflows(
      pledge,
      records({
        payments: [
          payment("paid-after", {}),
          payment("paid-before", { paidAtSec: 950 }),
          payment("bank", { method: "bank", bitcoin: null }),
        ],
        directTransfers: [
          direct("forwarded", {}),
          direct("fresh", { receivedAtSec: 1_250 }),
        ],
        withdrawals: [
          withdrawal("repayment", {
            pledge: { czk: czk(2_500), sources: [id("forwarded")] },
          }),
        ],
      }),
      2_000,
    );
    expect(inflows.map((inflow) => [inflow.id, inflow.sats])).toEqual([
      [id("fresh"), 1_000],
      [id("paid-after"), 100],
    ]);
  });

  it("holds an inflow whose forward just failed and frees it after the retry window", () => {
    const failed = withdrawal("failed", {
      status: "failed",
      createdAtSec: 1_500,
      pledge: { czk: czk(2_500), sources: [id("fresh")] },
    });
    const stored = records({
      directTransfers: [direct("fresh", {})],
      withdrawals: [failed],
    });
    expect(unforwardedInflows(pledge, stored, 1_600)).toEqual([]);
    expect(
      unforwardedInflows(pledge, stored, 1_500 + FORWARD_RETRY_SEC + 1).map(
        (inflow) => inflow.id,
      ),
    ).toEqual([id("fresh")]);
  });
});

describe("planForward", () => {
  it("forwards the whole inflow while it is worth less than the debt", () => {
    expect(planForward(czk(10_000), 1_000, rate)).toEqual({
      amountSats: 1_000,
      czk: 2_500,
    });
  });

  it("forwards only what the debt is worth and closes it exactly", () => {
    expect(planForward(czk(10_000), 5_000, rate)).toEqual({
      amountSats: 4_000,
      czk: 10_000,
    });
    expect(planForward(czk(1), 5_000, rate)).toEqual({
      amountSats: 1,
      czk: 1,
    });
  });

  it("plans nothing without a debt or an inflow", () => {
    expect(planForward(czk(0), 1_000, rate)).toBeNull();
    expect(planForward(czk(10_000), 0, rate)).toBeNull();
  });

  it("values a repayment that had to shrink at the rate", () => {
    const plan = { amountSats: 4_000, czk: czk(10_000) };
    expect(repaymentCzkFor(plan, 4_000, rate)).toBe(10_000);
    expect(repaymentCzkFor(plan, 3_000, rate)).toBe(7_500);
  });
});

describe("the pledger's messages", () => {
  it("are fixed Czech text", () => {
    expect(exchangeRequestMessage("Kavárna", czk(10_050))).toBe(
      "Kavárna žádá o směnu 100,50 Kč: hotovost za bitcoin.",
    );
    expect(pledgeOpenedMessage(czk(10_000))).toBe("Přijato do zástavy 100 Kč.");
    expect(
      pledgeRepaymentMessage(1_000, czk(2_500), czk(7_550), czk(10_050)),
    ).toBe(
      "Ze zástavy posláno 1\u00a0000 sat (≈ 25 Kč). Zbývá doplatit 75,50 Kč.",
    );
    expect(
      pledgeRepaymentMessage(4_000, czk(10_000), czk(0), czk(10_000)),
    ).toBe(
      "Ze zástavy posláno 4\u00a0000 sat (≈ 100 Kč). Zástava 100 Kč je splacená.",
    );
  });
});
