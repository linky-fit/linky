import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, RumorId, UnixSeconds } from "../domain/primitives";

export const PaymentTelemetryDirection = Schema.Literal("in", "out");
export type PaymentTelemetryDirection = typeof PaymentTelemetryDirection.Type;

export const PaymentTelemetryStatus = Schema.Literal("ok", "declined", "error");
export type PaymentTelemetryStatus = typeof PaymentTelemetryStatus.Type;

export const PaymentTelemetryMethod = Schema.Literal(
  "cashu_chat",
  "cashu_receive",
  "cashu_restore",
  "lightning_address",
  "lightning_invoice",
  "unknown",
);
export type PaymentTelemetryMethod = typeof PaymentTelemetryMethod.Type;

export const PaymentTelemetryPhase = Schema.Literal(
  "complete",
  "invoice_fetch",
  "melt",
  "publish",
  "receive",
  "restore",
  "swap",
  "unknown",
);
export type PaymentTelemetryPhase = typeof PaymentTelemetryPhase.Type;

/**
 * What kind of payment went out: to a contact, a Lightning invoice or
 * address outside a contact, the sats of a proxy payment, a run of a
 * recurring payment, or a paid payment request. Receives have none.
 */
export const PaymentTelemetryPaymentType = Schema.Literal(
  "contact",
  "lightning",
  "proxy",
  "recurring",
  "request",
);
export type PaymentTelemetryPaymentType =
  typeof PaymentTelemetryPaymentType.Type;

export const PaymentTelemetryDevicePlatform = Schema.Literal(
  "android",
  "iphone",
  "ipad",
  "linux",
  "mac",
  "windows",
  "unknown",
);
export type PaymentTelemetryDevicePlatform =
  typeof PaymentTelemetryDevicePlatform.Type;

export const PaymentTelemetryAppRuntime = Schema.Literal(
  "native",
  "pwa",
  "web",
);
export type PaymentTelemetryAppRuntime = typeof PaymentTelemetryAppRuntime.Type;

export class PaymentTelemetryDraft extends Schema.Class<PaymentTelemetryDraft>(
  "PaymentTelemetryDraft",
)({
  id: ClientId,
  createdAtSec: UnixSeconds,
  direction: PaymentTelemetryDirection,
  status: PaymentTelemetryStatus,
  method: PaymentTelemetryMethod,
  phase: PaymentTelemetryPhase,
  // Optional on the wire so outbox jobs persisted before the field decode.
  paymentType: Schema.optionalWith(Schema.NullOr(PaymentTelemetryPaymentType), {
    default: () => null,
  }),
  mint: Schema.NullOr(Schema.String),
  amountBucket: Schema.NullOr(Schema.String),
  feeBucket: Schema.NullOr(Schema.String),
  errorCode: Schema.NullOr(Schema.String),
  errorDetail: Schema.NullOr(Schema.String),
  appHost: Schema.NullOr(Schema.String),
  devicePlatform: Schema.NullOr(PaymentTelemetryDevicePlatform),
  appRuntime: Schema.NullOr(PaymentTelemetryAppRuntime),
  appVersion: Schema.String,
}) {}

export class PaymentTelemetryReceipt extends Schema.TaggedClass<PaymentTelemetryReceipt>()(
  "PaymentTelemetryReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    recipientCopy: WrapDelivery,
  },
) {}
