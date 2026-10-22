import type { OnchainTransferDirection } from "@linky-fit/onchain-transfer";
import {
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "./transfer";

/** Sums over completed transfers: `amount` is what users got, `sent` what they sent, the amount plus `fees`. */
export interface FlowTotals {
  readonly count: number;
  readonly amount: number;
  readonly sent: number;
  readonly fees: number;
}

export type TransferOutcome =
  | "completed"
  | "open"
  | "refunded"
  | "cancelled"
  | "denied";

export interface TransferAnalytics {
  readonly completed: FlowTotals;
  readonly byDirection: Readonly<Record<OnchainTransferDirection, FlowTotals>>;
  /** Every transfer in the period, whatever its outcome. */
  readonly outcomes: Readonly<Record<TransferOutcome, number>>;
}

export interface MonthAnalytics {
  /** "2026-10" */
  readonly month: string;
  readonly byDirection: Readonly<Record<OnchainTransferDirection, FlowTotals>>;
}

export const periods = ["allTime", "thisMonth", "last30Days"] as const;
export type Period = (typeof periods)[number];

const DAY_SEC = 86_400;
const noFlow: FlowTotals = { count: 0, amount: 0, sent: 0, fees: 0 };

const outcomeOf = (transfer: OperatorTransfer): TransferOutcome => {
  const status = transferStatus(transfer);
  switch (status) {
    case "completed":
    case "refunded":
    case "cancelled":
    case "denied":
      return status;
    default:
      return "open";
  }
};

const isCompleted = (transfer: OperatorTransfer): boolean =>
  outcomeOf(transfer) === "completed";

const addTransfer = (
  totals: FlowTotals,
  transfer: OperatorTransfer,
): FlowTotals => {
  const { fee, sendAmount } = transferTerms(transfer);
  return {
    count: totals.count + 1,
    amount: totals.amount + transfer.amount,
    sent: totals.sent + sendAmount,
    fees: totals.fees + fee,
  };
};

const flowOf = (transfers: readonly OperatorTransfer[]): FlowTotals =>
  transfers.reduce(addTransfer, noFlow);

const flowByDirection = (
  completed: readonly OperatorTransfer[],
): Record<OnchainTransferDirection, FlowTotals> => ({
  receive: flowOf(
    completed.filter((transfer) => transfer.direction === "receive"),
  ),
  send: flowOf(completed.filter((transfer) => transfer.direction === "send")),
});

/** The calendar month of a Unix time in `timeZone`, e.g. "2026-10". */
const monthKeyIn = (timeZone: string): ((sec: number) => string) => {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  return (sec) => {
    const parts = format.formatToParts(sec * 1000);
    const part = (type: "year" | "month") =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}`;
  };
};

/**
 * Whether a transfer requested at a Unix time falls in `period` as of `nowSec`.
 * "thisMonth" is the calendar month of `nowSec` in `timeZone`.
 */
export const inPeriod = (
  period: Period,
  nowSec: number,
  timeZone: string,
): ((sec: number) => boolean) => {
  switch (period) {
    case "allTime":
      return () => true;
    case "last30Days":
      return (sec) => sec > nowSec - 30 * DAY_SEC;
    case "thisMonth": {
      const monthOf = monthKeyIn(timeZone);
      const current = monthOf(nowSec);
      return (sec) => monthOf(sec) === current;
    }
  }
};

/** What flowed through the transfers whose request time `includes` accepts; only completed transfers count toward the totals. */
export const transferAnalytics = (
  transfers: readonly OperatorTransfer[],
  includes: (sec: number) => boolean,
): TransferAnalytics => {
  const inRange = transfers.filter((transfer) =>
    includes(transfer.createdAtSec),
  );
  const completed = inRange.filter(isCompleted);
  const outcomes: Record<TransferOutcome, number> = {
    completed: 0,
    open: 0,
    refunded: 0,
    cancelled: 0,
    denied: 0,
  };
  for (const transfer of inRange) outcomes[outcomeOf(transfer)] += 1;
  return {
    completed: flowOf(completed),
    byDirection: flowByDirection(completed),
    outcomes,
  };
};

/** The share of finished transfers that completed, 0 to 1; `null` while none finished. */
export const completionRate = (
  outcomes: Readonly<Record<TransferOutcome, number>>,
): number | null => {
  const finished =
    outcomes.completed +
    outcomes.refunded +
    outcomes.cancelled +
    outcomes.denied;
  return finished === 0 ? null : outcomes.completed / finished;
};

/** Completed transfers per calendar month of their request time in `timeZone`, newest month first. */
export const monthlyAnalytics = (
  transfers: readonly OperatorTransfer[],
  timeZone: string,
): readonly MonthAnalytics[] => {
  const monthOf = monthKeyIn(timeZone);
  const completed = transfers
    .filter(isCompleted)
    .map((transfer) => ({ transfer, month: monthOf(transfer.createdAtSec) }));
  const months = [...new Set(completed.map(({ month }) => month))].sort(
    (a, b) => b.localeCompare(a),
  );
  return months.map((month) => ({
    month,
    byDirection: flowByDirection(
      completed
        .filter((entry) => entry.month === month)
        .map(({ transfer }) => transfer),
    ),
  }));
};
