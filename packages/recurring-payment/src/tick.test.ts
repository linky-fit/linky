import { describe, expect, it } from "vitest";
import type { RecurringPaymentId } from "@linky-fit/domain";
import type { FiatRatesPerBtc } from "./amount";
import { recurringEnvelopeKey, type RecurringPaymentOrder } from "./order";
import {
  DUE,
  HOUR,
  MINT,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";
import {
  isRecurringUnfunded,
  planRecurringPaymentTick,
  runNowAction,
  unfundedAction,
} from "./tick";

const order = recurringOrderFixture;

const plan = (
  orders: RecurringPaymentOrder[],
  nowSec: number,
  extra: {
    balanceSat?: number;
    balanceMint?: string;
    fiatRates?: FiatRatesPerBtc | null;
    funded?: [string, number][];
    retry?: [RecurringPaymentId, number][];
  } = {},
) =>
  planRecurringPaymentTick({
    orders,
    nowSec,
    balanceSatByMint: new Map([
      [extra.balanceMint ?? MINT, extra.balanceSat ?? 1_000],
    ]),
    fiatRates: extra.fiatRates ?? null,
    fundedEnvelopeSat: new Map(extra.funded ?? []),
    retryNotBeforeSec: new Map(extra.retry ?? []),
  });

describe("planRecurringPaymentTick", () => {
  describe("sending", () => {
    it("does nothing before the due time", () => {
      expect(plan([order()], DUE - 1)).toEqual([]);
    });

    it("pays at the due time", () => {
      expect(plan([order()], DUE)).toMatchObject([
        {
          kind: "run",
          runIndex: 0,
          amountSat: 100,
          dueAtSec: DUE,
          missedCount: 0,
        },
      ]);
    });

    it("pays an overdue payment at once and counts the periods it missed", () => {
      expect(plan([order()], DUE + 13 * HOUR)).toMatchObject([
        { kind: "run", dueAtSec: DUE, missedCount: 2 },
      ]);
    });

    it("names the run by the order's count of paid runs", () => {
      const third = order({
        schedule: { ...order().schedule, runCount: 2 },
      });
      expect(plan([third], DUE)).toMatchObject([{ kind: "run", runIndex: 2 }]);
    });
  });

  describe("funds and failures", () => {
    it("waits for funds for the whole period, then folds into the next one", () => {
      const poor = { balanceSat: 50 };
      expect(plan([order()], DUE + HOUR, poor)).toMatchObject([
        { kind: "waitFunds", dueAtSec: DUE },
      ]);
      expect(plan([order()], DUE + 6 * HOUR - 1, poor)).toMatchObject([
        { kind: "waitFunds", dueAtSec: DUE },
      ]);
      // The next occurrence (6 h) is due: this one is skipped, not paid twice.
      expect(plan([order()], DUE + 6 * HOUR, poor)).toMatchObject([
        { kind: "skip", reason: "insufficientFunds", dueAtSec: DUE },
      ]);
    });

    it("counts only the balance at the order's mint", () => {
      expect(
        plan([order()], DUE, { balanceMint: "https://other.example" }),
      ).toMatchObject([{ kind: "waitFunds" }]);
    });

    it("hands an unfunded payment the run to pay from an envelope that already exists", () => {
      const run = { kind: "run", runIndex: 0, dueAtSec: DUE, amountSat: 100 };
      expect(plan([order()], DUE, { balanceSat: 0 })).toMatchObject([
        { kind: "waitFunds", run },
      ]);
      expect(plan([order()], DUE + 6 * HOUR, { balanceSat: 0 })).toMatchObject([
        { kind: "skip", reason: "insufficientFunds", run },
      ]);
    });

    it("turns a run the wallet could not fund into a wait, or a skip once its period ended", () => {
      const run = runNowAction(order(), 100);
      const waiting = unfundedAction(run, DUE + HOUR);
      const skipped = unfundedAction(run, DUE + 6 * HOUR);

      expect(waiting).toMatchObject({ kind: "waitFunds", dueAtSec: DUE, run });
      expect(skipped).toMatchObject({
        kind: "skip",
        reason: "insufficientFunds",
        dueAtSec: DUE,
        run,
      });
      expect([waiting, skipped].every(isRecurringUnfunded)).toBe(true);
      expect(
        isRecurringUnfunded({
          kind: "skip",
          order: order(),
          dueAtSec: DUE,
          reason: "failed",
        }),
      ).toBe(false);
    });

    it("pays a payment missed for days as soon as the wallet allows", () => {
      const monthly = order({
        schedule: {
          ...order().schedule,
          interval: { unit: "month", count: 1 },
        },
      });
      expect(
        plan([monthly], DUE + 3 * 24 * HOUR, { balanceSat: 50 }),
      ).toMatchObject([{ kind: "waitFunds" }]);
      expect(plan([monthly], DUE + 3 * 24 * HOUR)).toMatchObject([
        { kind: "run", dueAtSec: DUE },
      ]);
    });

    it("waits for an exchange rate before it can compare a fiat amount", () => {
      const fiat = order({ amount: { amount: 15_000, unit: "czk" } });
      expect(plan([fiat], DUE + HOUR)).toMatchObject([
        { kind: "waitRates", dueAtSec: DUE },
      ]);
      // 150.00 CZK at 2 000 000 CZK/BTC = 7 500 sat
      const rates: FiatRatesPerBtc = {
        brlPerBtc: 600_000,
        chfPerBtc: 90_000,
        czkPerBtc: 2_000_000,
        eurPerBtc: 100_000,
        usdPerBtc: 110_000,
      };
      expect(
        plan([fiat], DUE + HOUR, { balanceSat: 10_000, fiatRates: rates }),
      ).toMatchObject([{ kind: "run", amountSat: 7_500 }]);
    });

    it("pays a run from its funded envelope without a rate or balance", () => {
      const fiat = order({ amount: { amount: 15_000, unit: "czk" } });
      const funded: [string, number][] = [
        [recurringEnvelopeKey(fiat.id, 0), 7_400],
      ];
      expect(plan([fiat], DUE + HOUR, { balanceSat: 0, funded })).toMatchObject(
        [{ kind: "run", runIndex: 0, amountSat: 7_400 }],
      );
    });

    it("holds back a failed payment until its retry time", () => {
      const failed = order({
        lastRunStatus: "failed",
        lastRunAtSec: DUE + 60,
      });
      const retry: [RecurringPaymentId, number][] = [
        [recurringPaymentIdFor("rp-1"), DUE + 10 * 60],
      ];
      expect(plan([failed], DUE + 5 * 60, { retry })).toEqual([]);
      expect(plan([failed], DUE + 5 * 60, { retry, balanceSat: 0 })).toEqual(
        [],
      );
      expect(plan([failed], DUE + 10 * 60, { retry })).toMatchObject([
        { kind: "run" },
      ]);
    });

    it("skips a failed payment once the deadline passes", () => {
      const failed = order({
        lastRunStatus: "failed",
        lastRunAtSec: DUE + 60,
      });
      expect(plan([failed], DUE + 6 * HOUR)).toMatchObject([
        { kind: "skip", reason: "failed" },
      ]);
    });
  });

  it("does nothing for a paused payment", () => {
    const paused = order({
      schedule: { ...order().schedule, pausedAtSec: DUE - HOUR },
    });
    expect(plan([paused], DUE + HOUR)).toEqual([]);
  });

  it("orders actions by due time", () => {
    const later = order({
      id: recurringPaymentIdFor("rp-2"),
      schedule: {
        ...order().schedule,
        anchorAtSec: DUE + HOUR,
        nextDueAtSec: DUE + HOUR,
      },
    });
    const actions = plan([later, order()], DUE + 2 * HOUR);
    expect(actions.map((action) => action.order.id)).toEqual([
      recurringPaymentIdFor("rp-1"),
      recurringPaymentIdFor("rp-2"),
    ]);
  });
});

describe("runNowAction", () => {
  it("pays the pending period now, even before it is due", () => {
    const future = DUE + 5 * HOUR;
    const pending = order({
      schedule: { ...order().schedule, nextDueAtSec: future, runCount: 3 },
    });
    expect(runNowAction(pending, 100)).toMatchObject({
      kind: "run",
      runIndex: 3,
      amountSat: 100,
      dueAtSec: future,
      missedCount: 0,
    });
  });
});
