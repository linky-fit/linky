import { describe, expect, it } from "vitest";
import type { RecurringPaymentOrder } from "./recurringPaymentOrder";
import {
  planRecurringPaymentTick,
  RECURRING_RUN_GRACE_SEC,
  RECURRING_RUN_STALE_SEC,
} from "./recurringPaymentTick";

const HOUR = 3600;
const DUE = 1_800_000_000;

const order = (
  overrides: Partial<RecurringPaymentOrder> = {},
): RecurringPaymentOrder => ({
  id: "rp-1",
  ownerId: "owner-1",
  createdAtSec: DUE - 10 * HOUR,
  title: "Coffee",
  recipient: { kind: "contact", contactId: "contact-1" },
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
  executorDeviceId: "device-a",
  note: null,
  ...overrides,
});

const plan = (
  orders: RecurringPaymentOrder[],
  nowSec: number,
  extra: { cashuBalance?: number; retry?: [string, number][] } = {},
) =>
  planRecurringPaymentTick({
    orders,
    nowSec,
    deviceId: "device-a",
    cashuBalance: extra.cashuBalance ?? 1_000,
    retryNotBeforeSec: new Map(extra.retry ?? []),
  });

describe("planRecurringPaymentTick", () => {
  it("runs a due order and advances past the periods that passed", () => {
    const [action] = plan([order()], DUE + 13 * HOUR);
    expect(action).toMatchObject({
      kind: "run",
      dueAtSec: DUE,
      missedCount: 2,
      advance: { nextDueAtSec: DUE + 18 * HOUR, runCount: 1 },
    });
  });

  it("does nothing before the due time", () => {
    expect(plan([order()], DUE - 1)).toEqual([]);
  });

  it("leaves orders bound to another device alone", () => {
    expect(plan([order({ executorDeviceId: "device-b" })], DUE)).toEqual([]);
  });

  it("waits for funds inside the grace window, then skips", () => {
    const poor = { cashuBalance: 50 };
    expect(plan([order()], DUE + HOUR, poor)).toMatchObject([
      { kind: "waitFunds", dueAtSec: DUE },
    ]);
    // The next occurrence (6 h) comes before the 24 h grace: skip there.
    expect(plan([order()], DUE + 6 * HOUR, poor)).toMatchObject([
      { kind: "skip", reason: "insufficientFunds", dueAtSec: DUE },
    ]);
  });

  it("applies the full grace window when the interval is longer", () => {
    const monthly = order({
      schedule: {
        ...order().schedule,
        interval: { unit: "month", count: 1 },
      },
    });
    const poor = { cashuBalance: 50 };
    expect(
      plan([monthly], DUE + RECURRING_RUN_GRACE_SEC - 1, poor),
    ).toMatchObject([{ kind: "waitFunds" }]);
    expect(plan([monthly], DUE + RECURRING_RUN_GRACE_SEC, poor)).toMatchObject([
      { kind: "skip", reason: "insufficientFunds" },
    ]);
  });

  it("holds back a failed order until its retry time", () => {
    const failed = order({ lastRunStatus: "failed", lastRunAtSec: DUE + 60 });
    expect(
      plan([failed], DUE + 5 * 60, { retry: [["rp-1", DUE + 10 * 60]] }),
    ).toEqual([]);
    expect(
      plan([failed], DUE + 10 * 60, { retry: [["rp-1", DUE + 10 * 60]] }),
    ).toMatchObject([{ kind: "run" }]);
  });

  it("skips a failed order once the deadline passes", () => {
    const failed = order({ lastRunStatus: "failed", lastRunAtSec: DUE + 60 });
    expect(plan([failed], DUE + 6 * HOUR)).toMatchObject([
      { kind: "skip", reason: "failed" },
    ]);
  });

  it("still pays once when a fresh due time is long overdue", () => {
    const stale = order({
      lastRunStatus: "paid",
      lastRunAtSec: DUE - 6 * HOUR,
    });
    expect(plan([stale], DUE + 3 * 24 * HOUR)).toMatchObject([{ kind: "run" }]);
  });

  it("marks a stale running mark interrupted and waits on a fresh one", () => {
    const running = order({ lastRunStatus: "running", lastRunAtSec: DUE });
    expect(plan([running], DUE + 60)).toEqual([]);
    expect(plan([running], DUE + RECURRING_RUN_STALE_SEC + 1)).toMatchObject([
      { kind: "markInterrupted" },
    ]);
  });

  it("orders runs by due time", () => {
    const later = order({
      id: "rp-2",
      schedule: {
        ...order().schedule,
        anchorAtSec: DUE + HOUR,
        nextDueAtSec: DUE + HOUR,
      },
    });
    const actions = plan([later, order()], DUE + 2 * HOUR);
    expect(actions.map((a) => a.order.id)).toEqual(["rp-1", "rp-2"]);
  });
});
