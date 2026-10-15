import type { TransactionId } from "@linky-fit/domain";
import { CzkAmount, satsToCzk } from "./money";
import type { DirectTransfer, Payment } from "./records";

/** One line of the history: a payment the terminal asked for, or a direct transfer. */
export type HistoryEntry =
  | {
      readonly kind: "payment";
      readonly id: TransactionId;
      readonly atSec: number;
      readonly receivedCzk: CzkAmount;
      readonly payment: Payment;
    }
  | {
      readonly kind: "direct";
      readonly id: TransactionId;
      readonly atSec: number;
      readonly receivedCzk: CzkAmount;
      readonly transfer: DirectTransfer;
    };

const isShown = (record: { readonly hiddenAtSec: number | null }) =>
  record.hiddenAtSec === null;

/** A pending payment can still turn paid, so the merchant hides only an entry that settled. */
export const canHideFromHistory = (entry: HistoryEntry): boolean =>
  entry.kind === "direct" || entry.payment.status !== "pending";

/** A direct transfer's CZK value at the rate it arrived at; `null` without one. */
export const directTransferCzk = (
  transfer: DirectTransfer,
): CzkAmount | null =>
  transfer.czkPerBtc === null
    ? null
    : satsToCzk(transfer.sats, transfer.czkPerBtc);

/**
 * Payments at the time they were created and direct transfers at the time
 * they arrived, without the ones the merchant hid. What each adds to the
 * day's takings: a paid payment its amount, a direct transfer its CZK value
 * at its rate, so the day total is all the money received; a transfer
 * without a rate adds nothing.
 */
export const historyEntries = (
  payments: readonly Payment[],
  transfers: readonly DirectTransfer[],
): HistoryEntry[] => [
  ...payments.filter(isShown).map(
    (payment): HistoryEntry => ({
      kind: "payment",
      id: payment.id,
      atSec: payment.createdAtSec,
      receivedCzk:
        payment.status === "paid" ? payment.amountCzk : CzkAmount.make(0),
      payment,
    }),
  ),
  ...transfers.filter(isShown).map(
    (transfer): HistoryEntry => ({
      kind: "direct",
      id: transfer.id,
      atSec: transfer.receivedAtSec,
      receivedCzk: directTransferCzk(transfer) ?? CzkAmount.make(0),
      transfer,
    }),
  ),
];

export interface HistoryDay {
  /** Local midnight that starts the day, in seconds. */
  readonly startSec: number;
  /** What was actually received that day. */
  readonly paidTotal: CzkAmount;
  readonly entries: readonly HistoryEntry[];
}

export const startOfDaySec = (sec: number) =>
  new Date(sec * 1000).setHours(0, 0, 0, 0) / 1000;

/** Groups entries, newest first, by their local day. */
export const groupByDay = (entries: readonly HistoryEntry[]): HistoryDay[] => {
  const days = new Map<number, HistoryEntry[]>();
  for (const entry of entries) {
    const day = startOfDaySec(entry.atSec);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return [...days]
    .sort(([a], [b]) => b - a)
    .map(([startSec, dayEntries]) => ({
      startSec,
      paidTotal: CzkAmount.make(
        dayEntries.reduce((total, entry) => total + entry.receivedCzk, 0),
      ),
      entries: [...dayEntries].sort((a, b) => b.atSec - a.atSec),
    }));
};

/** "today" or "yesterday" relative to `nowSec`, otherwise `null` for a dated label. */
export const relativeDay = (
  startSec: number,
  nowSec: number,
): "today" | "yesterday" | null => {
  const today = new Date(startOfDaySec(nowSec) * 1000);
  if (startSec * 1000 === today.getTime()) return "today";
  today.setDate(today.getDate() - 1);
  return startSec * 1000 === today.getTime() ? "yesterday" : null;
};
