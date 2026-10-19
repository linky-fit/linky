import {
  ClientId,
  decodeNpub,
  OutboxRef,
  PaymentTelemetryDraft,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import { Exit, Schema } from "effect";
import React from "react";
import {
  LOCAL_PENDING_PAYMENT_TELEMETRY_LOCK_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
} from "../../utils/constants";
import type { LocalPaymentTelemetryEvent } from "../types/appTypes";
import { isLocalPaymentTelemetryEvent } from "../lib/paymentTelemetry";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
  withLocalStorageLeaseLock,
} from "../../utils/storage";
import { onOnline } from "../../platform/appEvents";

interface UseAnonymousPaymentTelemetryParams {
  appOwnerId: string | null;
  makeLocalStorageKey: (prefix: string) => string;
}

const PAYMENT_TELEMETRY_FLUSH_INTERVAL_MS = 45_000;
const MAX_ITEMS_PER_FLUSH = 10;
const isClientId = Schema.is(ClientId);
const isUnixSeconds = Schema.is(UnixSeconds);

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
    paymentType: item.paymentType ?? null,
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
  const { enqueuePaymentTelemetry } = useLinkstrCommands();

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

    const intervalId = setInterval(() => {
      void flushQueue();
    }, PAYMENT_TELEMETRY_FLUSH_INTERVAL_MS);

    const unsubscribeOnline = onOnline(() => void flushQueue());
    return () => {
      unsubscribeOnline();
      clearInterval(intervalId);
    };
  }, [appOwnerId, flushQueue]);
};
