import type { Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import React from "react";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../utils/storage";

const STORAGE_KEY = "linky.listings.hidden.v1";

const StoredKeys = Schema.Array(Schema.String);

/** The key a contact's listing is hidden under: its author and the author's id for it. */
export const hiddenListingKey = (author: Pubkey, listingId: string): string =>
  `${author}:${listingId}`;

let hidden: ReadonlyArray<string> = safeLocalStorageGetJson(
  STORAGE_KEY,
  StoredKeys,
  [],
);
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): ReadonlyArray<string> => hidden;

/** Hides a contact's listing on this device, or shows it again. */
export const setListingHidden = (
  author: Pubkey,
  listingId: string,
  isHidden: boolean,
): void => {
  const key = hiddenListingKey(author, listingId);
  const without = hidden.filter((candidate) => candidate !== key);
  hidden = isHidden ? [...without, key] : without;
  safeLocalStorageSetJson(STORAGE_KEY, hidden);
  listeners.forEach((listener) => listener());
};

/** The keys of the contacts' listings hidden on this device. */
export const useHiddenListingKeys = (): ReadonlySet<string> => {
  const keys = React.useSyncExternalStore(subscribe, getSnapshot);
  return React.useMemo(() => new Set(keys), [keys]);
};

export const useIsListingHidden = (
  author: Pubkey,
  listingId: string,
): boolean => useHiddenListingKeys().has(hiddenListingKey(author, listingId));

/** Test-only: forgets every hidden listing. */
export const resetHiddenListingsForTests = (): void => {
  hidden = [];
  listeners.forEach((listener) => listener());
};
