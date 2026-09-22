import { identityFromNsec } from "@linky-fit/linkstr";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { RECURRING_REMINDERS_SYNCED_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
import type { RecurringPaymentOrder } from "../../lib/recurringPaymentOrder";
import { RECURRING_NOTICE_SEC } from "../../lib/recurringPaymentTick";

/** The server keeps at most this many per pubkey; the soonest ones matter. */
export const MAX_SYNCED_REMINDERS = 32;
const SYNC_DEBOUNCE_MS = 2_000;
/** Re-send an unchanged set this often so a server that lost it recovers. */
const RESYNC_AFTER_MS = 12 * 60 * 60 * 1000;

interface UseRecurringReminderSyncParams {
  currentNsec: string | null;
  enabled: boolean;
  orders: ReadonlyArray<RecurringPaymentOrder>;
  dependencies?: {
    isPushRegisteredForIdentity?: (currentNsec: string) => boolean;
    nowSec?: () => number;
    syncRecurringReminders?: (
      currentNsec: string,
      notifyAtSecs: readonly number[],
    ) => Promise<{ success: boolean; error?: string }>;
  };
}

/** When the push service should nudge the user: the notice window before each next due time. */
export const reminderTimesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): number[] =>
  orders
    .filter((order) => order.schedule.pausedAtSec === null)
    .map((order) => order.schedule.nextDueAtSec - RECURRING_NOTICE_SEC)
    .filter((notifyAtSec) => notifyAtSec >= nowSec)
    .sort((a, b) => a - b)
    .slice(0, MAX_SYNCED_REMINDERS);

interface SyncedRemindersRecord {
  atMs: number;
  key: string;
}

const readSynced = (storageKey: string): SyncedRemindersRecord | null => {
  const raw = safeLocalStorageGet(storageKey);
  if (!raw) return null;
  const [atMsText, ...rest] = raw.split(":");
  const atMs = Number.parseInt(atMsText ?? "", 10);
  return Number.isFinite(atMs) ? { atMs, key: rest.join(":") } : null;
};

/**
 * Keeps the push service's reminder set for this identity equal to the
 * upcoming due times, so a closed app still gets a push when a payment is
 * about to be ready. Only runs when this install has push registered; the
 * server sees times, never amounts or recipients.
 */
export const useRecurringReminderSync = ({
  currentNsec,
  dependencies,
  enabled,
  orders,
}: UseRecurringReminderSyncParams): void => {
  const nowSec = dependencies?.nowSec ?? nowSeconds;
  const timesKey = React.useMemo(
    () => reminderTimesFor(orders, nowSec()).join(","),
    // Order changes are what matter; the clock only trims past times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );

  React.useEffect(() => {
    if (!enabled || !currentNsec) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const { isPushRegisteredForIdentity, syncRecurringReminders } =
          await import("../../../utils/pushNotifications");
        const isRegistered =
          dependencies?.isPushRegisteredForIdentity ??
          isPushRegisteredForIdentity;
        const sync =
          dependencies?.syncRecurringReminders ?? syncRecurringReminders;
        if (cancelled || !isRegistered(currentNsec)) return;

        const pubkey = identityFromNsec(currentNsec)?.pubkey;
        if (!pubkey) return;
        const storageKey = `${RECURRING_REMINDERS_SYNCED_STORAGE_KEY_PREFIX}${pubkey}`;
        const synced = readSynced(storageKey);
        const nowMs = Date.now();
        if (
          synced !== null &&
          synced.key === timesKey &&
          nowMs - synced.atMs < RESYNC_AFTER_MS
        ) {
          return;
        }
        const notifyAtSecs = timesKey
          ? timesKey.split(",").map((value) => Number.parseInt(value, 10))
          : [];
        const result = await sync(currentNsec, notifyAtSecs);
        if (cancelled) return;
        if (result.success) {
          safeLocalStorageSet(storageKey, `${nowMs}:${timesKey}`);
        }
        reportAppLog({
          tag: "recurring.remindersSynced",
          summary: result.success
            ? `recurring reminders synced (${notifyAtSecs.length})`
            : "recurring reminders sync failed",
          payload: {
            count: notifyAtSecs.length,
            notifyAtSecs,
            ...(result.success ? {} : { error: result.error ?? "unknown" }),
          },
        });
      })();
    }, SYNC_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [currentNsec, dependencies, enabled, timesKey]);
};
