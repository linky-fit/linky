import { Schema } from "effect";

/** How a payment was paid; `null` on a payment nobody paid yet. */
export const PaymentMethod = Schema.Literals(["bank", "lightning", "cashu"]);
export type PaymentMethod = typeof PaymentMethod.Type;

export const PaymentStatus = Schema.Literals(["pending", "paid", "cancelled"]);
export type PaymentStatus = typeof PaymentStatus.Type;

const NEXT_STATUSES: Readonly<
  Record<PaymentStatus, ReadonlyArray<PaymentStatus>>
> = {
  pending: ["paid", "cancelled"],
  // A Lightning or Cashu payment can still arrive after the merchant cancels.
  cancelled: ["paid"],
  paid: [],
};

export const canChangePaymentStatus = (
  from: PaymentStatus,
  to: PaymentStatus,
): boolean => NEXT_STATUSES[from].includes(to);
