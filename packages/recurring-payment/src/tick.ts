import type { RecurringPaymentId } from "@linky-fit/domain";
import { recurringAmountSat, type FiatRatesPerBtc } from "./amount";
import { recurringEnvelopeKey, type RecurringPaymentOrder } from "./order";
import { decideRecurringRun, nextDueAfter } from "./schedule";

/**
 * Countdown shown in the app before a due payment goes out, with pay-now and
 * cancel. Only when the app is visible; in the background the payment is sent
 * at its due time without it.
 */
export const RECURRING_CONFIRM_SEC = 10;
/** Pause between attempts of a run whose last attempt failed. */
export const RECURRING_RUN_RETRY_DELAY_SEC = 10 * 60;

export type RecurringSkipReason =
  | "insufficientFunds"
  | "failed"
  | "cancelled"
  | "invalidRecipient";

/** One payment of an order: its number and the due time it pays. */
export interface RecurringRun {
  order: RecurringPaymentOrder;
  /** The order's `runCount` when the run was planned; names its envelope. */
  runIndex: number;
  dueAtSec: number;
}

export interface RecurringRunAction extends RecurringRun {
  kind: "run";
  /** The amount a new envelope is opened with; an existing one keeps its own. */
  amountSat: number;
  missedCount: number;
}

/**
 * The balance at the order's mint does not cover `run`. Its envelope may
 * still exist (funded before a restart, or by another device), so ask the
 * mint before waiting or skipping, and pay `run` from it if it does.
 */
interface RecurringUnfunded {
  order: RecurringPaymentOrder;
  dueAtSec: number;
  run: RecurringRunAction;
}

export type RecurringTickAction =
  | RecurringRunAction
  | {
      kind: "skip";
      order: RecurringPaymentOrder;
      dueAtSec: number;
      reason: "failed";
    }
  | (RecurringUnfunded & { kind: "skip"; reason: "insufficientFunds" })
  | (RecurringUnfunded & { kind: "waitFunds" })
  | { kind: "waitRates"; order: RecurringPaymentOrder; dueAtSec: number };

/** `waitFunds` or the `insufficientFunds` skip: both carry the `run` the balance did not cover. */
export type RecurringUnfundedAction = Extract<
  RecurringTickAction,
  { run: RecurringRunAction }
>;

export const isRecurringUnfunded = (
  action: RecurringTickAction,
): action is RecurringUnfundedAction =>
  action.kind === "waitFunds" ||
  (action.kind === "skip" && action.reason === "insufficientFunds");

export interface RecurringTickInput {
  orders: ReadonlyArray<RecurringPaymentOrder>;
  nowSec: number;
  /** Available sats per mint URL; a due run waits until its mint covers the amount. */
  balanceSatByMint: ReadonlyMap<string, number>;
  /** Null while no rate is known; a fiat payment without a funded envelope then waits. */
  fiatRates: FiatRatesPerBtc | null;
  /**
   * Sats of each run envelope the mint is known to have signed, by
   * `recurringEnvelopeKey`. Such a run pays from its envelope, so it needs
   * neither an exchange rate nor balance.
   */
  fundedEnvelopeSat: ReadonlyMap<string, number>;
  /** Per order id: no new attempt before this time (set after a failure). */
  retryNotBeforeSec: ReadonlyMap<RecurringPaymentId, number>;
}

/**
 * End of the window in which a due run may still be attempted: the next due
 * time. A payment waits for funds or retries failures for its whole period,
 * so a late or unfunded one still goes out once the wallet allows; only when
 * the following period is already due does the missed one fold into it.
 */
export const recurringSkipDeadlineSec = (
  order: RecurringPaymentOrder,
  dueAtSec: number,
): number => nextDueAfter(order.schedule, dueAtSec);

/** A run the balance does not cover waits for funds until its period ends, then is skipped. */
export const unfundedAction = (
  run: RecurringRunAction,
  nowSec: number,
): RecurringUnfundedAction => {
  const { order, dueAtSec } = run;
  return nowSec >= recurringSkipDeadlineSec(order, dueAtSec)
    ? { kind: "skip", order, dueAtSec, reason: "insufficientFunds", run }
    : { kind: "waitFunds", order, dueAtSec, run };
};

const planOrder = (
  order: RecurringPaymentOrder,
  input: RecurringTickInput,
): RecurringTickAction | null => {
  const decision = decideRecurringRun(order.schedule, input.nowSec);
  if (decision.kind !== "due") return null;
  const { dueAtSec, missedCount } = decision;
  const deadlinePassed =
    input.nowSec >= recurringSkipDeadlineSec(order, dueAtSec);
  const attemptedThisPeriod =
    order.lastRunStatus === "failed" &&
    order.lastRunAtSec !== null &&
    order.lastRunAtSec >= dueAtSec;
  if (attemptedThisPeriod && deadlinePassed) {
    return { kind: "skip", order, dueAtSec, reason: "failed" };
  }
  const runIndex = order.schedule.runCount;
  const envelopeSat = input.fundedEnvelopeSat.get(
    recurringEnvelopeKey(order.id, runIndex),
  );
  const amountSat =
    envelopeSat ?? recurringAmountSat(order.amount, input.fiatRates);
  if (amountSat === null) return { kind: "waitRates", order, dueAtSec };
  const retryNotBefore = input.retryNotBeforeSec.get(order.id) ?? 0;
  if (input.nowSec < retryNotBefore) return null;
  const run: RecurringRunAction = {
    kind: "run",
    order,
    runIndex,
    amountSat,
    dueAtSec,
    missedCount,
  };
  const balanceSat = input.balanceSatByMint.get(order.mintUrl) ?? 0;
  if (envelopeSat !== undefined || balanceSat >= amountSat) return run;
  return unfundedAction(run, input.nowSec);
};

/**
 * What one scheduler pass should do. Actions come out ordered by due time so
 * the longest-overdue payment goes first when the wallet is free.
 */
export const planRecurringPaymentTick = (
  input: RecurringTickInput,
): RecurringTickAction[] => {
  const actions = input.orders.flatMap((order) => {
    const action = planOrder(order, input);
    return action === null ? [] : [action];
  });
  return actions.sort((a, b) => a.dueAtSec - b.dueAtSec);
};

/** A run started on demand, outside the planner: it pays the pending period, even one not due yet. */
export const runNowAction = (
  order: RecurringPaymentOrder,
  amountSat: number,
): RecurringRunAction => ({
  kind: "run",
  order,
  runIndex: order.schedule.runCount,
  amountSat,
  dueAtSec: order.schedule.nextDueAtSec,
  missedCount: 0,
});
