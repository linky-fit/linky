import { CzkAmount } from "./money";
import type { PaymentStatus } from "./payment";

interface DatedPayment {
  readonly createdAtSec: number;
  readonly status: PaymentStatus;
  readonly amountCzk: CzkAmount;
}

export interface PaymentDay<P extends DatedPayment> {
  /** Local midnight that starts the day, in seconds. */
  readonly startSec: number;
  /** What was actually paid that day; pending and cancelled payments do not count. */
  readonly paidTotal: CzkAmount;
  readonly payments: readonly P[];
}

const startOfDaySec = (sec: number) =>
  new Date(sec * 1000).setHours(0, 0, 0, 0) / 1000;

/** Groups payments, newest first, by the local day they were created on. */
export const groupByDay = <P extends DatedPayment>(
  payments: readonly P[],
): PaymentDay<P>[] => {
  const days = new Map<number, P[]>();
  for (const payment of payments) {
    const day = startOfDaySec(payment.createdAtSec);
    days.set(day, [...(days.get(day) ?? []), payment]);
  }
  return [...days]
    .sort(([a], [b]) => b - a)
    .map(([startSec, dayPayments]) => ({
      startSec,
      paidTotal: CzkAmount.make(
        dayPayments
          .filter((payment) => payment.status === "paid")
          .reduce((total, payment) => total + payment.amountCzk, 0),
      ),
      payments: [...dayPayments].sort(
        (a, b) => b.createdAtSec - a.createdAtSec,
      ),
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
