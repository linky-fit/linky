// Migration bridge; removal gate in app/migrations/AGENTS.md
//
// Older releases kept a contact payment made offline in a localStorage queue
// behind a "Queued payment" chat placeholder and sent it once back online.
// Payments now fail offline instead, so every entry left on a device is
// dropped and its placeholder says the payment failed. A queued payment had
// no token yet, so no funds are involved.
//
// Removal condition: delete this file, its call site in
// useContactsMessagingComposition and the LOCAL_PENDING_PAYMENTS_* constants.

import { Schema } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import {
  LOCAL_PENDING_PAYMENTS_LOCK,
  LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
import { UnknownRecord } from "../../utils/schema";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
  withTabLock,
} from "../../utils/storage";
import { trimString } from "../../utils/validation";
import type { UpdateLocalNostrMessage } from "../types/appTypes";

const queueKey = (appOwnerId: string) =>
  `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${appOwnerId}`;

/**
 * Empties the queue and returns the placeholder message ids it held. It takes
 * the lock an older tab flushes under, so no entry is both sent and dropped.
 */
export const takeOfflinePaymentQueue = async (
  appOwnerId: string,
): Promise<string[]> => {
  const key = queueKey(appOwnerId);
  return withTabLock(LOCAL_PENDING_PAYMENTS_LOCK, async () => {
    if (safeLocalStorageGet(key) === null) return [];
    const messageIds = safeLocalStorageGetJson(
      key,
      Schema.Array(UnknownRecord),
      [],
    ).flatMap((entry) => trimString(entry.messageId) || []);
    safeLocalStorageRemove(key);
    return messageIds;
  });
};

/** Drops the offline payment queue an older release left, once the account is hydrated. */
export const useOfflinePaymentQueueDrain = ({
  appOwnerId,
  failedNotice,
  hydrated,
  updateLocalNostrMessage,
}: {
  readonly appOwnerId: string | null;
  /** The localized text each placeholder is replaced with. */
  readonly failedNotice: string;
  readonly hydrated: boolean;
  readonly updateLocalNostrMessage: UpdateLocalNostrMessage;
}): void => {
  const startedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!hydrated || !appOwnerId || startedRef.current === appOwnerId) return;
    startedRef.current = appOwnerId;
    void takeOfflinePaymentQueue(appOwnerId).then((messageIds) => {
      if (messageIds.length === 0) return;
      for (const messageId of messageIds)
        void updateLocalNostrMessage(messageId, {
          content: failedNotice,
          status: "sent",
          localOnly: true,
        });
      reportAppLog({
        tag: "payment.offlineQueueDropped",
        summary: `Dropped ${messageIds.length} payments an older release queued offline`,
        links: { message: messageIds },
        payload: { dropped: messageIds.length },
      });
    });
  }, [appOwnerId, failedNotice, hydrated, updateLocalNostrMessage]);
};
