import { classifyPaymentErrorCode } from "@linky/linkstr";
export { classifyPaymentErrorCode } from "@linky/linkstr";
import {
  getTelemetryAppHost,
  getTelemetryAppRuntime,
  getTelemetryDevicePlatform,
} from "../../platform/runtime";
import { normalizeMintUrl } from "../../utils/mint";
import { makeLocalId } from "../../utils/validation";
import type {
  LocalPaymentTelemetryEvent,
  LoggedPaymentEventParams,
  PaymentTelemetryMethod,
  PaymentTelemetryPhase,
  PaymentTelemetryStatus,
} from "../types/appTypes";

const AMOUNT_BUCKETS = [1, 10, 100, 1_000, 10_000, 100_000];
const FEE_BUCKETS = [1, 5, 10, 25, 100, 500];

const clampBucket = (value: number, buckets: readonly number[]): string => {
  for (const bucket of buckets) {
    if (value <= bucket) {
      return `lte_${bucket}`;
    }
  }

  const lastBucket = buckets.at(-1);
  return lastBucket ? `gt_${lastBucket}` : "unknown";
};

const bucketPositiveNumber = (
  value: number | null | undefined,
  buckets: readonly number[],
): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return clampBucket(Math.floor(value), buckets);
};

const asTelemetryMethod = (
  value: LoggedPaymentEventParams["method"],
): PaymentTelemetryMethod => {
  switch (value) {
    case "cashu_chat":
    case "cashu_receive":
    case "cashu_restore":
    case "lightning_address":
    case "lightning_invoice":
      return value;
    default:
      return "unknown";
  }
};

const asTelemetryPhase = (
  value: LoggedPaymentEventParams["phase"],
): PaymentTelemetryPhase => {
  switch (value) {
    case "complete":
    case "invoice_fetch":
    case "melt":
    case "publish":
    case "receive":
    case "restore":
    case "swap":
      return value;
    default:
      return "unknown";
  }
};

export const normalizePaymentTelemetryErrorDetail = (
  value: string | null | undefined,
): string | null => {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.slice(0, 500);
};

export const normalizePaymentTelemetryMint = (
  value: string | null | undefined,
): string | null => {
  const normalized = normalizeMintUrl(value);
  if (!normalized) return null;
  return normalized.slice(0, 500);
};

const isDeclinedPaymentErrorCode = (value: string | null): boolean => {
  return value === "insufficient" || value === "invalid_amount";
};

export const normalizePaymentTelemetryStatus = (args: {
  error: string | null | undefined;
  status: PaymentTelemetryStatus;
}): PaymentTelemetryStatus => {
  if (args.status === "ok" || args.status === "declined") {
    return args.status;
  }

  const errorCode = classifyPaymentErrorCode(args.error);
  return isDeclinedPaymentErrorCode(errorCode) ? "declined" : "error";
};

export const createLocalPaymentTelemetryEvent = (
  event: LoggedPaymentEventParams,
  createdAtSec: number,
): LocalPaymentTelemetryEvent => {
  const errorCode = classifyPaymentErrorCode(event.error);

  return {
    id: makeLocalId(),
    createdAtSec,
    direction: event.direction,
    status: normalizePaymentTelemetryStatus({
      error: event.error,
      status: event.status,
    }),
    method: asTelemetryMethod(event.method),
    phase: asTelemetryPhase(event.phase),
    mint: normalizePaymentTelemetryMint(event.mint),
    amountBucket: bucketPositiveNumber(event.amount, AMOUNT_BUCKETS),
    feeBucket: bucketPositiveNumber(event.fee, FEE_BUCKETS),
    errorCode,
    errorDetail: normalizePaymentTelemetryErrorDetail(event.error),
    appHost: getTelemetryAppHost(),
    devicePlatform: getTelemetryDevicePlatform(),
    appRuntime: getTelemetryAppRuntime(),
    appVersion: __APP_VERSION__,
  };
};
