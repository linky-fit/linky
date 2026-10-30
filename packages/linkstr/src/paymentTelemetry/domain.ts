import { Effect, Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, RumorId, UnixSeconds } from "../domain/primitives";

export const PaymentTelemetryDirection = Schema.Literals(["in", "out"]);
export type PaymentTelemetryDirection = typeof PaymentTelemetryDirection.Type;

export const PaymentTelemetryStatus = Schema.Literals([
  "ok",
  "declined",
  "error",
]);
export type PaymentTelemetryStatus = typeof PaymentTelemetryStatus.Type;

export const PaymentTelemetryMethod = Schema.Literals([
  "cashu_chat",
  "cashu_receive",
  "cashu_restore",
  "lightning_address",
  "lightning_invoice",
  "unknown",
]);
export type PaymentTelemetryMethod = typeof PaymentTelemetryMethod.Type;

export const PaymentTelemetryPhase = Schema.Literals([
  "complete",
  "invoice_fetch",
  "melt",
  "publish",
  "receive",
  "restore",
  "swap",
  "unknown",
]);
export type PaymentTelemetryPhase = typeof PaymentTelemetryPhase.Type;

/**
 * What kind of payment the report is about. Outgoing: to a contact, a
 * Lightning invoice or address outside a contact, the sats of a proxy
 * payment, a run of a recurring payment, a paid payment request, or a token
 * issued for sharing. Incoming: a token from a contact, a token paying the
 * user's own payment request, a token accepted outside a contact, sats to
 * the user's Lightning address, a top-up over Lightning, a restore, or a
 * payment request the user sent out.
 */
export const PaymentTelemetryPaymentType = Schema.Literals([
  "contact",
  "lightning",
  "proxy",
  "recurring",
  "request",
  "issue",
  "received_contact",
  "received_request",
  "received_token",
  "received_lightning",
  "topup",
  "restore",
  "request_sent",
]);
export type PaymentTelemetryPaymentType =
  typeof PaymentTelemetryPaymentType.Type;

export const PaymentTelemetryDevicePlatform = Schema.Literals([
  "android",
  "iphone",
  "ipad",
  "linux",
  "mac",
  "windows",
  "unknown",
]);
export type PaymentTelemetryDevicePlatform =
  typeof PaymentTelemetryDevicePlatform.Type;

export const PaymentTelemetryAppRuntime = Schema.Literals([
  "native",
  "pwa",
  "web",
]);
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
  paymentType: Schema.NullOr(PaymentTelemetryPaymentType).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(null)),
    Schema.withConstructorDefault(Effect.succeed(null)),
  ),
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
