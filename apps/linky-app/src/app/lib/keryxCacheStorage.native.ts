import { Option, Schema } from "effect";
import { localStorageKv } from "../../utils/storage";
import { KeryxCacheEntry } from "./keryxCache";

// expo-sqlite's localStorage has no browser quota, so entries with inline data URLs fit.
const KEY_PREFIX = "linky.keryxCache.";

const decodeEntry = Schema.decodeUnknownOption(
  Schema.fromJsonString(KeryxCacheEntry),
);

/** The cached entry of a join origin; null when none is stored or it no longer decodes. */
export const readKeryxCacheEntry = async (
  origin: string,
): Promise<KeryxCacheEntry | null> =>
  Option.getOrNull(decodeEntry(localStorageKv.getItem(KEY_PREFIX + origin)));

export const writeKeryxCacheEntry = async (
  origin: string,
  entry: KeryxCacheEntry,
): Promise<void> =>
  localStorageKv.setItem(
    KEY_PREFIX + origin,
    JSON.stringify(Schema.encodeSync(KeryxCacheEntry)(entry)),
  );

export const deleteKeryxCacheEntry = async (origin: string): Promise<void> =>
  localStorageKv.removeItem(KEY_PREFIX + origin);
