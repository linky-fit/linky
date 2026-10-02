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
  RECURRING_CLAIM_TAKEOVER_SEC,
  RECURRING_NOTICE_SEC,
  recurringUpcoming,
  runNowAction,
  unfundedAction,
} from "./tick";

const NOTICE = RECURRING_NOTICE_SEC;
const order = recurringOrderFixture;

const claimedBy = (
  deviceId: string,
  atSec: number,
  dueAtSec = DUE,
): Partial<RecurringPaymentOrder> => ({
  claim: { deviceId, atSec, dueAtSec },
});

const plan = (
  orders: RecurringPaymentOrder[],
  nowSec: number,
  extra: {
    balanceSat?: number;
    balanceMint?: string;
    deviceId?: string;
    fiatRates?: FiatRatesPerBtc | null;
    funded?: [string, number][];
    retry?: [RecurringPaymentId, number][];
  } = {},
) =>
  planRecurringPaymentTick({
    orders,
    nowSec,
    deviceId: extra.deviceId ?? "device-a",
    balanceSatByMint: new Map([
      [extra.balanceMint ?? MINT, extra.balanceSat ?? 1_000],
    ]),
    fiatRates: extra.fiatRates ?? null,
    fundedEnvelopeSat: new Map(extra.funded ?? []),
    retryNotBeforeSec: new Map(extra.retry ?? []),
  });

describe("planRecurringPaymentTick", () => {
  describe("claiming", () => {
    it("does nothing before the notice window opens", () => {
      expect(plan([order()], DUE - NOTICE - 1)).toEqual([]);
    });

    it("claims a payment once it is within the notice window", () => {
      expect(plan([order()], DUE - NOTICE)).toMatchObject([
        { kind: "claim", dueAtSec: DUE, takeover: false },
      ]);
    });

    it("claims again when the claim is for an earlier due time", () => {
      const stale = order(
        claimedBy("device-b", DUE - 7 * HOUR, DUE - 6 * HOUR),
      );
      expect(plan([stale], DUE - 60)).toMatchObject([
        { kind: "claim", takeover: false },
      ]);
    });

    it("any device may claim, so a second device claims too", () => {
      expect(plan([order()], DUE, { deviceId: "device-b" })).toMatchObject([
        { kind: "claim" },
      ]);
    });
  });

  describe("sending", () => {
    it("waits out the notice window, then the claimant pays", () => {
      const claimed = order(claimedBy("device-a", DUE - NOTICE));
      expect(plan([claimed], DUE - 1)).toEqual([]);
      expect(plan([claimed], DUE)).toMatchObject([
        {
          kind: "run",
          runIndex: 0,
          amountSat: 100,
          dueAtSec: DUE,
          missedCount: 0,
        },
      ]);
    });

    it("gives a late claim its full notice window after the due time", () => {
      const late = order(claimedBy("device-a", DUE + 13 * HOUR));
      expect(plan([late], DUE + 13 * HOUR + NOTICE - 1)).toEqual([]);
      expect(plan([late], DUE + 13 * HOUR + NOTICE)).toMatchObject([
        { kind: "run", dueAtSec: DUE, missedCount: 2 },
      ]);
    });

    it("leaves a payment claimed by another device to that device", () => {
      const theirs = order(claimedBy("device-b", DUE - NOTICE));
      expect(plan([theirs], DUE)).toEqual([]);
    });

    it("names the run by the order's count of paid runs", () => {
      const third = order({
        ...claimedBy("device-a", DUE - NOTICE),
        schedule: { ...order().schedule, runCount: 2 },
      });
      expect(plan([third], DUE)).toMatchObject([{ kind: "run", runIndex: 2 }]);
    });

    it("takes over when the claimant never paid", () => {
      const theirs = order(claimedBy("device-b", DUE - NOTICE));
      expect(plan([theirs], DUE + RECURRING_CLAIM_TAKEOVER_SEC - 1)).toEqual(
        [],
      );
      expect(plan([theirs], DUE + RECURRING_CLAIM_TAKEOVER_SEC)).toMatchObject([
        { kind: "claim", takeover: true },
      ]);
    });
  });

  describe("funds and failures", () => {
    const mine = claimedBy("device-a", DUE - NOTICE);

    it("waits for funds for the whole period, then folds into the next one", () => {
      const poor = { balanceSat: 50 };
      expect(plan([order(mine)], DUE + HOUR, poor)).toMatchObject([
        { kind: "waitFunds", dueAtSec: DUE },
      ]);
      expect(plan([order(mine)], DUE + 6 * HOUR - 1, poor)).toMatchObject([
        { kind: "waitFunds", dueAtSec: DUE },
      ]);
      // The next occurrence (6 h) is due: this one is skipped, not paid twice.
      expect(plan([order(mine)], DUE + 6 * HOUR, poor)).toMatchObject([
        { kind: "skip", reason: "insufficientFunds", dueAtSec: DUE },
      ]);
    });

    it("counts only the balance at the order's mint", () => {
      expect(
        plan([order(mine)], DUE, { balanceMint: "https://other.example" }),
      ).toMatchObject([{ kind: "waitFunds" }]);
    });

    it("hands an unfunded payment the run to pay from an envelope that already exists", () => {
      const run = { kind: "run", runIndex: 0, dueAtSec: DUE, amountSat: 100 };
      expect(plan([order(mine)], DUE, { balanceSat: 0 })).toMatchObject([
        { kind: "waitFunds", run },
      ]);
      expect(
        plan([order(mine)], DUE + 6 * HOUR, { balanceSat: 0 }),
      ).toMatchObject([{ kind: "skip", reason: "insufficientFunds", run }]);
    });

    it("turns a run the wallet could not fund into a wait, or a skip once its period ended", () => {
      const run = runNowAction(order(mine), 100);
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
        ...mine,
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
      const fiat = order({ ...mine, amount: { amount: 15_000, unit: "czk" } });
      expect(plan([fiat], DUE + HOUR)).toMatchObject([
        { kind: "waitRates", dueAtSec: DUE },
      ]);
      // 150.00 CZK at 2 000 000 CZK/BTC = 7 500 sat
      const rates: FiatRatesPerBtc = {
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
      const fiat = order({ ...mine, amount: { amount: 15_000, unit: "czk" } });
      const funded: [string, number][] = [
        [recurringEnvelopeKey(fiat.id, 0), 7_400],
      ];
      expect(plan([fiat], DUE + HOUR, { balanceSat: 0, funded })).toMatchObject(
        [{ kind: "run", runIndex: 0, amountSat: 7_400 }],
      );
    });

    it("holds back a failed payment until its retry time", () => {
      const failed = order({
        ...mine,
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
        ...mine,
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

describe("recurringUpcoming", () => {
  it("reports an unclaimed payment inside the notice window", () => {
    expect(recurringUpcoming(order(), DUE - 60)).toEqual({
      dueAtSec: DUE,
      sendAtSec: null,
      claimDeviceId: null,
    });
  });

  it("reports when a claimed payment goes out", () => {
    expect(
      recurringUpcoming(order(claimedBy("device-b", DUE - 60)), DUE - 30),
    ).toEqual({
      dueAtSec: DUE,
      sendAtSec: DUE - 60 + NOTICE,
      claimDeviceId: "device-b",
    });
  });

  it("is quiet while nothing is due soon", () => {
    expect(recurringUpcoming(order(), DUE - NOTICE - 1)).toBeNull();
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
});
