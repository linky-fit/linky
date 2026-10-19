import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Schema } from "effect";
import {
  readKvJson,
  safeSessionStorageClear,
  safeSessionStorageGet,
  safeSessionStorageSet,
  writeKvJson,
} from "../utils/storage";

const RELOAD_SNAPSHOT_KEY = "linky.native.sessionStorage";

const Snapshot = Schema.Array(Schema.Tuple([Schema.String, Schema.String]));

export type SessionStorageLike = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem" | "clear"
>;

/**
 * The native `sessionStorage`: memory for one app run. A reload carries it
 * over through the snapshot `keepSessionStorageForReload` wrote; a cold
 * start finds none and starts empty.
 */
export const makeReloadableSessionStorage = (
  kv: KeyValueStorage,
): SessionStorageLike => {
  const entries = new Map(readKvJson(kv, RELOAD_SNAPSHOT_KEY, Snapshot, []));
  kv.removeItem(RELOAD_SNAPSHOT_KEY);
  return {
    get length() {
      return entries.size;
    },
    key: (index) => Array.from(entries.keys())[index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
  };
};

/** Saves the session's `entries` for the next app run; call it right before reloading. */
export const keepSessionStorageForReload = (
  kv: KeyValueStorage,
  entries: ReadonlyArray<readonly [string, string]>,
): void => writeKvJson(kv, RELOAD_SNAPSHOT_KEY, entries);

/** The launch URL this app run handled; the OS hands every reload of the run the same URL. */
export const HANDLED_LAUNCH_URL_KEY = "linky.native.launchUrl";

/** Empties the session for a logout, except the handled launch URL, so the next reload does not take that link again. */
export const clearSessionForLogout = (): void => {
  const launchUrl = safeSessionStorageGet(HANDLED_LAUNCH_URL_KEY);
  safeSessionStorageClear();
  if (launchUrl !== null)
    safeSessionStorageSet(HANDLED_LAUNCH_URL_KEY, launchUrl);
};
