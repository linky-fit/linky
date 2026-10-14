import type { IconName, Tone } from "@linky-fit/ui";
import { copy } from "../copy";
import type { Payment, PaymentMethod, PaymentStatus } from "../domain";

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

/** How a payment was paid, or that it was shown as a QR code while nobody paid it. */
export const methodLabel = (payment: Payment): string =>
  payment.method === null ? copy.history.qrShown : copy.methods[payment.method];
