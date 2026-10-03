import { identityFromNsec } from "@linky-fit/linkstr";
import {
  reminderNotesFor,
  reminderTimesFor,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useLatest } from "../../../hooks/useLatest";
import { RECURRING_REMINDERS_SYNCED_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import {
  storeRecurringReminderNotes,
  type RecurringReminderNotes,
} from "../../../utils/recurringReminderNotes";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
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
    storeReminderNotes?: (notes: RecurringReminderNotes) => Promise<void>;
    syncRecurringReminders?: (
      currentNsec: string,
      notifyAtSecs: readonly number[],
    ) => Promise<{ success: boolean; error?: string }>;
  };
}

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
 * upcoming due times, so a closed app gets a push when a payment is due, and
 * stores the notes due at each time on the device for the service worker to
 * name them. Only runs when this install has push registered; the server sees
 * times, never notes, amounts or recipients.
 */
export const useRecurringReminderSync = ({
  currentNsec,
  dependencies,
  enabled,
  orders,
}: UseRecurringReminderSyncParams): void => {
  const nowSec = dependencies?.nowSec ?? nowSeconds;
  const reminders = React.useMemo(
    () => {
      const now = nowSec();
      return {
        times: reminderTimesFor(orders, now),
        notes: reminderNotesFor(orders, now),
      };
    },
    // Order changes are what matter; the clock only trims past times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );
  const timesKey = reminders.times.join(",");
  const notesKey = JSON.stringify([...reminders.notes]);
  const latestReminders = useLatest(reminders);

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

        const { times: notifyAtSecs, notes } = latestReminders.current;
        const syncedKey = notifyAtSecs.join(",");
        const storeNotes =
          dependencies?.storeReminderNotes ?? storeRecurringReminderNotes;
        await storeNotes(notes).catch((error: unknown) => {
          console.warn("[linky][recurring] reminder notes not stored", error);
        });
        if (cancelled) return;

        const pubkey = identityFromNsec(currentNsec)?.pubkey;
        if (!pubkey) return;
        const storageKey = `${RECURRING_REMINDERS_SYNCED_STORAGE_KEY_PREFIX}${pubkey}`;
        const synced = readSynced(storageKey);
        const nowMs = Date.now();
        if (
          synced !== null &&
          synced.key === syncedKey &&
          nowMs - synced.atMs < RESYNC_AFTER_MS
        ) {
          return;
        }
        const result = await sync(currentNsec, notifyAtSecs);
        if (cancelled) return;
        if (result.success) {
          safeLocalStorageSet(storageKey, `${nowMs}:${syncedKey}`);
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
  }, [currentNsec, dependencies, enabled, latestReminders, notesKey, timesKey]);
};
