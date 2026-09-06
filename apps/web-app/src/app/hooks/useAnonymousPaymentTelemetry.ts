import type { OwnerId } from "@evolu/common";
import {
  ClientId,
  decodeNpub,
  OutboxRef,
  PaymentTelemetryDraft,
  UnixSeconds,
} from "@linky/linkstr";
import { enqueuePaymentTelemetryAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit, Schema } from "effect";
import React from "react";
import {
  LOCAL_PENDING_PAYMENT_TELEMETRY_LOCK_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
} from "../../utils/constants";
import type { LocalPaymentTelemetryEvent } from "../types/appTypes";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
  withLocalStorageLeaseLock,
} from "../../utils/storage";

interface UseAnonymousPaymentTelemetryParams {
  appOwnerId: OwnerId | null;
  makeLocalStorageKey: (prefix: string) => string;
}

const PAYMENT_TELEMETRY_FLUSH_INTERVAL_MS = 45_000;
/** Telemetry shares the outbox's FIFO lane with chat, so it is drained in
 * small batches rather than all at once. */
const MAX_ITEMS_PER_FLUSH = 10;
const isClientId = Schema.is(ClientId);
const isUnixSeconds = Schema.is(UnixSeconds);

const LocalPaymentTelemetryEventSchema = Schema.Struct({
  id: Schema.String,
  createdAtSec: Schema.Number,
  direction: Schema.Literal("in", "out"),
  status: Schema.Literal("declined", "error", "ok"),
  method: Schema.Literal(
    "cashu_chat",
    "cashu_receive",
    "cashu_restore",
    "lightning_address",
    "lightning_invoice",
    "unknown",
  ),
  phase: Schema.Literal(
    "complete",
    "invoice_fetch",
    "melt",
    "publish",
    "receive",
    "restore",
    "swap",
    "unknown",
  ),
  appVersion: Schema.String,
  appHost: Schema.optional(Schema.NullOr(Schema.String)),
  appRuntime: Schema.optional(
    Schema.NullOr(Schema.Literal("native", "pwa", "web")),
  ),
  devicePlatform: Schema.optional(
    Schema.NullOr(
      Schema.Literal(
        "android",
        "iphone",
        "ipad",
        "linux",
        "mac",
        "windows",
        "unknown",
      ),
    ),
  ),
  mint: Schema.NullOr(Schema.String),
  amountBucket: Schema.NullOr(Schema.String),
  feeBucket: Schema.NullOr(Schema.String),
  errorCode: Schema.NullOr(Schema.String),
  errorDetail: Schema.NullOr(Schema.String),
});

export const isLocalPaymentTelemetryEvent = (
  value: unknown,
): value is LocalPaymentTelemetryEvent =>
  Schema.is(LocalPaymentTelemetryEventSchema)(value);

const readQueue = (storageKey: string): LocalPaymentTelemetryEvent[] => {
  return safeLocalStorageGetJson(
    storageKey,
    Schema.Array(Schema.Unknown),
    [],
  ).filter(isLocalPaymentTelemetryEvent);
};

const writeQueue = (
  storageKey: string,
  items: readonly LocalPaymentTelemetryEvent[],
): void => {
  safeLocalStorageSetJson(storageKey, Array.from(items));
};

const toPaymentTelemetryDraft = (
  item: LocalPaymentTelemetryEvent,
): PaymentTelemetryDraft | null => {
  if (!isClientId(item.id) || !isUnixSeconds(item.createdAtSec)) return null;
  return new PaymentTelemetryDraft({
    id: item.id,
    createdAtSec: item.createdAtSec,
    direction: item.direction,
    status: item.status,
    method: item.method,
    phase: item.phase,
    mint: item.mint,
    amountBucket: item.amountBucket,
    feeBucket: item.feeBucket,
    errorCode: item.errorCode,
    errorDetail: item.errorDetail,
    appHost: item.appHost ?? null,
    devicePlatform: item.devicePlatform ?? null,
    appRuntime: item.appRuntime ?? null,
    appVersion: item.appVersion,
  });
};

/**
 * Payment events are recorded into a per-owner localStorage buffer before the
 * linkstr runtime is necessarily ready; this hook hands them to the outbox,
 * which owns delivery and retries from that moment on.
 */
export const useAnonymousPaymentTelemetry = ({
  appOwnerId,
  makeLocalStorageKey,
}: UseAnonymousPaymentTelemetryParams): void => {
  const flushRef = React.useRef<Promise<void> | null>(null);
  const enqueuePaymentTelemetry = useAtomSet(enqueuePaymentTelemetryAtom, {
    mode: "promiseExit",
  });

  const flushQueue = React.useCallback(async () => {
    if (!appOwnerId) return;
    if (flushRef.current) return;

    const storageKey = makeLocalStorageKey(
      LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
    );
    const lockKey = makeLocalStorageKey(
      LOCAL_PENDING_PAYMENT_TELEMETRY_LOCK_STORAGE_KEY_PREFIX,
    );

    // The lock is what keeps two tabs from enqueueing the same pending item
    // twice: the outbox does not dedupe across tabs.
    const run = withLocalStorageLeaseLock({
      key: lockKey,
      fn: async () => {
        const pending = readQueue(storageKey);
        if (pending.length === 0) return;

        const recipient = decodeNpub(PAYMENT_ANALYTICS_RECIPIENT_NPUB);
        if (!recipient) return;
        const remainingById = new Map(pending.map((item) => [item.id, item]));

        for (const item of pending.slice(0, MAX_ITEMS_PER_FLUSH)) {
          const draft = toPaymentTelemetryDraft(item);
          if (draft === null) {
            remainingById.delete(item.id); // unencodable: it can never be sent
            continue;
          }

          const outcome = await enqueuePaymentTelemetry({
            draft,
            recipient,
            ref: OutboxRef.make(`telemetry:${item.id}`),
          });
          if (Exit.isSuccess(outcome)) remainingById.delete(item.id);
        }

        writeQueue(storageKey, Array.from(remainingById.values()));
      },
    }).finally(() => {
      flushRef.current = null;
    });

    flushRef.current = run;
    await run;
  }, [appOwnerId, makeLocalStorageKey, enqueuePaymentTelemetry]);

  React.useEffect(() => {
    void flushQueue();
  }, [flushQueue]);

  React.useEffect(() => {
    if (!appOwnerId) return;

    const handleOnline = () => {
      void flushQueue();
    };

    const intervalId = window.setInterval(() => {
      void flushQueue();
    }, PAYMENT_TELEMETRY_FLUSH_INTERVAL_MS);

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.clearInterval(intervalId);
    };
  }, [appOwnerId, flushQueue]);
};
