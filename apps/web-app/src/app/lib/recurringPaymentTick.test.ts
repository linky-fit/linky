import { describe, expect, it } from "vitest";
import type { RecurringPaymentOrder } from "./recurringPaymentOrder";
import {
  planRecurringPaymentTick,
  RECURRING_CLAIM_TAKEOVER_SEC,
  RECURRING_NOTICE_SEC,
  RECURRING_RUN_GRACE_SEC,
  RECURRING_RUN_STALE_SEC,
  recurringUpcoming,
} from "./recurringPaymentTick";

const HOUR = 3600;
const DUE = 1_800_000_000;
const NOTICE = RECURRING_NOTICE_SEC;

const order = (
  overrides: Partial<RecurringPaymentOrder> = {},
): RecurringPaymentOrder => ({
  id: "rp-1",
  ownerId: "owner-1",
  createdAtSec: DUE - 10 * HOUR,
  contactId: "contact-1",
  amountSat: 100,
  schedule: {
    anchorAtSec: DUE,
    interval: { unit: "hour", count: 6 },
    timeZone: "UTC",
    nextDueAtSec: DUE,
    runCount: 0,
    maxRuns: null,
    endAtSec: null,
    pausedAtSec: null,
  },
  lastRunAtSec: null,
  lastRunStatus: null,
  claim: null,
  ...overrides,
});

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
    cashuBalance?: number;
    deviceId?: string;
    retry?: [string, number][];
  } = {},
) =>
  planRecurringPaymentTick({
    orders,
    nowSec,
    deviceId: extra.deviceId ?? "device-a",
    cashuBalance: extra.cashuBalance ?? 1_000,
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
          dueAtSec: DUE,
          missedCount: 0,
          advance: { nextDueAtSec: DUE + 6 * HOUR, runCount: 1 },
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

    it("waits for funds inside the grace window, then skips", () => {
      const poor = { cashuBalance: 50 };
      expect(plan([order(mine)], DUE + HOUR, poor)).toMatchObject([
        { kind: "waitFunds", dueAtSec: DUE },
      ]);
      // The next occurrence (6 h) comes before the 24 h grace: skip there.
      expect(plan([order(mine)], DUE + 6 * HOUR, poor)).toMatchObject([
        { kind: "skip", reason: "insufficientFunds", dueAtSec: DUE },
      ]);
    });

    it("applies the full grace window when the interval is longer", () => {
      const monthly = order({
        ...mine,
        schedule: {
          ...order().schedule,
          interval: { unit: "month", count: 1 },
        },
      });
      const poor = { cashuBalance: 50 };
      expect(
        plan([monthly], DUE + RECURRING_RUN_GRACE_SEC - 1, poor),
      ).toMatchObject([{ kind: "waitFunds" }]);
      expect(
        plan([monthly], DUE + RECURRING_RUN_GRACE_SEC, poor),
      ).toMatchObject([{ kind: "skip", reason: "insufficientFunds" }]);
    });

    it("holds back a failed payment until its retry time", () => {
      const failed = order({
        ...mine,
        lastRunStatus: "failed",
        lastRunAtSec: DUE + 60,
      });
      const retry: [string, number][] = [["rp-1", DUE + 10 * 60]];
      expect(plan([failed], DUE + 5 * 60, { retry })).toEqual([]);
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

  it("marks a stale running mark interrupted and waits on a fresh one", () => {
    const running = order({ lastRunStatus: "running", lastRunAtSec: DUE });
    expect(plan([running], DUE + 60)).toEqual([]);
    expect(plan([running], DUE + RECURRING_RUN_STALE_SEC + 1)).toMatchObject([
      { kind: "markInterrupted" },
    ]);
  });

  it("does nothing for a paused payment", () => {
    const paused = order({
      schedule: { ...order().schedule, pausedAtSec: DUE - HOUR },
    });
    expect(plan([paused], DUE + HOUR)).toEqual([]);
  });

  it("orders actions by due time", () => {
    const later = order({
      id: "rp-2",
      schedule: {
        ...order().schedule,
        anchorAtSec: DUE + HOUR,
        nextDueAtSec: DUE + HOUR,
      },
    });
    const actions = plan([later, order()], DUE + 2 * HOUR);
    expect(actions.map((action) => action.order.id)).toEqual(["rp-1", "rp-2"]);
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

  it("is quiet while a run is in flight or nothing is due soon", () => {
    expect(
      recurringUpcoming(order({ lastRunStatus: "running" }), DUE),
    ).toBeNull();
    expect(recurringUpcoming(order(), DUE - NOTICE - 1)).toBeNull();
  });
});
