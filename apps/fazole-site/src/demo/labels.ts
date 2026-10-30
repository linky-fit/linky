import type { IconName, Tone } from "@linky-fit/ui";
import { copy } from "../copy";
import { formatCrowns, formatDay } from "./money";
import type { DemoPayment, PaymentMethod, PaymentStatus } from "./store";

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
