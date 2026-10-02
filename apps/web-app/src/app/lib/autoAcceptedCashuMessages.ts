import { Schema } from "effect";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import type { LocalNostrMessage } from "../types/appTypes";

// Messages whose cashu token the message-driven auto-accept has already
// resolved terminally — received, already known, or permanently spent. The
// in-session dedup ref forgets these on reload, and linkshu deliberately keeps
// a failed receive retryable, so without a persistent record a permanently
// spent token is re-attempted (and re-fails) on every launch. Only terminal
// outcomes are recorded; a transient mint failure stays retryable.
// Entries are rumor ids; entries stored before them are row ids.
const STORAGE_KEY = "linky.cashu.auto_accepted_message_ids.v1";
const MAX_TRACKED_IDS = 1000;

const MessageKeys = Schema.Array(Schema.String);

type KeyedMessage = Pick<LocalNostrMessage, "id" | "rumorId">;

/** The rumor id, the same on every device and for every row of the message; the row id without one. */
export const cashuAutoAcceptKey = (message: KeyedMessage): string =>
  (message.rumorId ?? "").trim() || message.id.trim();

const read = (): readonly string[] =>
  safeLocalStorageGetJson(STORAGE_KEY, MessageKeys, []);

export const isCashuAutoAcceptResolved = (message: KeyedMessage): boolean => {
  const keys = [cashuAutoAcceptKey(message), message.id.trim()].filter(Boolean);
  const resolved = read();
  return keys.some((key) => resolved.includes(key));
};

export const markCashuAutoAcceptResolved = (message: KeyedMessage): void => {
  const key = cashuAutoAcceptKey(message);
  if (!key) return;
  const current = read();
  if (current.includes(key)) return;
  // Bounded FIFO: newest kept, oldest dropped.
  safeLocalStorageSetJson(
    STORAGE_KEY,
    [...current, key].slice(-MAX_TRACKED_IDS),
  );
};
