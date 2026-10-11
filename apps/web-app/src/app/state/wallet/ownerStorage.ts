import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  CASHU_SEEN_MINTS_STORAGE_KEY,
  normalizeMintUrl,
} from "../../../utils/mint";
import { readKvJson, writeKvJson } from "../../../utils/storage";
import { platformAtom } from "../platform";
import { appOwnerIdAtom } from "../session/store";

/** The device-local storage key `prefix` scoped to the app owner. */
export const ownerStorageKey = (prefix: string, ownerId: string): string =>
  `${prefix}.${ownerId}`;

export interface OwnerStorage {
  readonly key: (prefix: string) => string;
  /** Mints the wallet ever touched on this device, recovery candidates. */
  readonly readSeenMints: () => string[];
  readonly rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

export const makeOwnerStorage = (
  kv: KeyValueStorage,
  ownerId: string,
): OwnerStorage => {
  const key = (prefix: string) => ownerStorageKey(prefix, ownerId);
  const readSeenMints = () =>
    readKvJson(
      kv,
      key(CASHU_SEEN_MINTS_STORAGE_KEY),
      Schema.Array(Schema.String),
      [],
    )
      .map((value) => normalizeMintUrl(value))
      .filter(Boolean);
  return {
    key,
    readSeenMints,
    rememberSeenMint: (mintUrl) => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned) return;
      const seen = new Set(readSeenMints());
      seen.add(cleaned);
      writeKvJson(
        kv,
        key(CASHU_SEEN_MINTS_STORAGE_KEY),
        Array.from(seen).slice(0, 50),
      );
    },
  };
};

/** Device-local storage scoped to the session's app owner. */
export const ownerStorageAtom = Atom.keepAlive(
  Atom.readable((get) =>
    AsyncResult.map(get(appOwnerIdAtom), (ownerId) =>
      makeOwnerStorage(get(platformAtom).kv, ownerId),
    ),
  ),
);
