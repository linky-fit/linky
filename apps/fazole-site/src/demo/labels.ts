import type { IconName, Tone } from "@linky-fit/ui";
import { copy } from "../copy";
import { formatCrowns, formatDay } from "./money";
import type {
  DemoPayment,
  DemoWithdrawal,
  PaymentMethod,
  PaymentStatus,
} from "./store";

const t = copy.demo;

export const statusTones: Record<PaymentStatus, Tone> = {
  pending: "warning",
  paid: "accent",
  cancelled: "neutral",
};

export const methodIcons: Record<PaymentMethod, IconName> = {
  bank: "Landmark",
  lightning: "Zap",
  cashu: "Bitcoin",
};

export const paymentIcon = (payment: DemoPayment): IconName =>
  payment.method === null ? "QrCode" : methodIcons[payment.method];

/** How a payment was paid, or that it was shown as a QR code while nobody paid it. */
export const methodLabel = (payment: DemoPayment): string =>
  payment.method === null ? t.history.qrShown : t.methods[payment.method];

/** "1 250 Kč", the way the app writes an amount. */
export const czk = (halere: number): string =>
  t.czkAmount(formatCrowns(halere));

const startOfDay = (date: Date) => new Date(date).setHours(0, 0, 0, 0);

/** Payments grouped by the local day they were created on, newest first, with each day's paid total. */
export const groupByDay = (payments: readonly DemoPayment[]) => {
  const days = new Map<number, DemoPayment[]>();
  for (const payment of payments) {
    const day = startOfDay(payment.createdAt);
    days.set(day, [...(days.get(day) ?? []), payment]);
  }
  return [...days]
    .sort(([a], [b]) => b - a)
    .map(([startMs, dayPayments]) => ({
      startMs,
      paidTotal: dayPayments
        .filter((payment) => payment.status === "paid")
        .reduce((total, payment) => total + payment.amountHalere, 0),
      payments: dayPayments.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    }));
};

/** "Dnes", "Včera" or the date, like the app's history headings. */
export const dayTitle = (startMs: number, now: Date): string => {
  const today = startOfDay(now);
  const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
  if (startMs === today) return t.history.today;
  if (startMs === yesterday) return t.history.yesterday;
  return formatDay(new Date(startMs));
};

export interface Activity {
  readonly id: string;
  readonly at: Date;
  readonly icon: IconName;
  readonly direction: "in" | "out";
  readonly sats: number;
  readonly feeSats: number;
  readonly label: string;
}

/** Bitcoin payments and withdrawals, newest first, like the app's wallet activity. */
export const walletActivity = (
  payments: readonly DemoPayment[],
  withdrawals: readonly DemoWithdrawal[],
): Activity[] =>
  [
    ...payments.flatMap((payment): Activity[] =>
      payment.status === "paid" &&
      payment.sats !== null &&
      payment.method !== null
        ? [
            {
              id: payment.id,
              at: payment.paidAt ?? payment.createdAt,
              icon: methodIcons[payment.method],
              direction: "in",
              sats: payment.sats,
              feeSats: 0,
              label: t.methods[payment.method],
            },
          ]
        : [],
    ),
    ...withdrawals.map(
      (withdrawal): Activity => ({
        id: withdrawal.id,
        at: withdrawal.at,
        icon: withdrawal.kind === "linky" ? "Send" : "ArrowUpRight",
        direction: "out",
        sats: withdrawal.sats + withdrawal.feeSats,
        feeSats: withdrawal.feeSats,
        label:
          withdrawal.kind === "linky"
            ? t.wallet.withdrawalLinky
            : t.wallet.withdrawalLightning,
      }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
