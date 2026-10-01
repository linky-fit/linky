import { parsePubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import { UnknownRecord } from "../../utils/schema";
import { LOCAL_PENDING_PAYMENTS_LOCK } from "../../utils/constants";
import {
  canLockAcrossTabs,
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { trimString } from "../../utils/validation";
import type { LocalPendingPayment } from "../types/appTypes";

export const readPendingPayments = (key: string): LocalPendingPayment[] =>
  safeLocalStorageGetJson(key, Schema.Array(UnknownRecord), [])
    .map((payment) => {
      const recipientPubkey = parsePubkey(trimString(payment.recipientPubkey));
      const messageId = trimString(payment.messageId);
      return {
        id: trimString(payment.id),
        contactId: trimString(payment.contactId),
        amountSat: Math.max(0, Math.trunc(Number(payment.amountSat ?? 0) || 0)),
        createdAtSec: Math.max(
          0,
          Math.trunc(Number(payment.createdAtSec ?? 0) || 0),
        ),
        ...(recipientPubkey ? { recipientPubkey } : {}),
        ...(messageId ? { messageId } : {}),
      };
    })
    .filter(
      (payment) => payment.id && payment.contactId && payment.amountSat > 0,
    );

const isStored = (key: string, id: string): boolean =>
  readPendingPayments(key).some((payment) => payment.id === id);

/**
 * Removes the entry from storage before it is sent, so no tab can send it
 * again. Null when it is already gone or the removal did not persist.
 */
export const claimStoredPendingPayment = (
  key: string,
  id: string,
): LocalPendingPayment | null => {
  const stored = readPendingPayments(key);
  const claimed = stored.find((payment) => payment.id === id) ?? null;
  if (!claimed) return null;
  safeLocalStorageSetJson(
    key,
    stored.filter((payment) => payment !== claimed),
  );
  return isStored(key, id) ? null : claimed;
};

export const appendStoredPendingPayment = (
  key: string,
  payment: LocalPendingPayment,
): void => {
  const stored = readPendingPayments(key).filter(
    (candidate) => candidate.id !== payment.id,
  );
  safeLocalStorageSetJson(key, [...stored, payment].slice(-200));
};

/** Waits for a running flush, so the write cannot bring back an entry it claimed. */
export const enqueueStoredPendingPayment = async (
  key: string,
  payment: LocalPendingPayment,
): Promise<void> => {
  if (!canLockAcrossTabs()) return appendStoredPendingPayment(key, payment);
  await navigator.locks.request(LOCAL_PENDING_PAYMENTS_LOCK, async () =>
    appendStoredPendingPayment(key, payment),
  );
};

/**
 * Runs the flush unless another tab is already flushing. Without Web Locks
 * it never runs: the boot shim cannot keep two tabs from sending one entry.
 */
export const withPendingPaymentsFlushLock = async (
  flush: () => Promise<void>,
): Promise<void> => {
  if (!canLockAcrossTabs()) return;
  await navigator.locks.request(
    LOCAL_PENDING_PAYMENTS_LOCK,
    { ifAvailable: true },
    (lock) => (lock ? flush() : undefined),
  );
};
