import type { Pubkey, UnixSeconds } from "../domain/primitives";
import { Rumor, rumorWithHash } from "../internal/nostrEvent";
import type { PaymentTelemetryDraft } from "./domain";

export const PAYMENT_TELEMETRY_KIND = 24134;
export const PAYMENT_TELEMETRY_VALUE = "payment_telemetry";

export const encodePaymentTelemetryRumor = (
  draft: PaymentTelemetryDraft,
  author: Pubkey,
  recipient: Pubkey,
  sentAt: UnixSeconds,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: PAYMENT_TELEMETRY_KIND,
    tags: [
      ["p", recipient],
      ["client", draft.id],
      ["linky", PAYMENT_TELEMETRY_VALUE],
    ],
    content: JSON.stringify({
      v: 1,
      id: draft.id,
      createdAtSec: draft.createdAtSec,
      direction: draft.direction,
      status: draft.status,
      method: draft.method,
      phase: draft.phase,
      paymentType: draft.paymentType,
      mint: draft.mint,
      amountBucket: draft.amountBucket,
      feeBucket: draft.feeBucket,
      errorCode: draft.errorCode,
      errorDetail: draft.errorDetail,
      appHost: draft.appHost,
      devicePlatform: draft.devicePlatform,
      appRuntime: draft.appRuntime,
      appVersion: draft.appVersion,
    }),
  });
