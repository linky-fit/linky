import type { AppOwner } from "@evolu/common";
import {
  appOwnerFromMnemonic,
  type ShardDb,
  type ShardRetention,
} from "../core";
import {
  createLinkyStore,
  type LinkyDbSchema,
  type LinkyScopes,
  type LinkyStore,
} from "../model";
import type { KeyValueStorage } from "./keyValueStorage";

/** Set while this device holds an account it adopted whose data, shard pointers included, has not arrived yet. */
const awaitingFirstHydrationKey = (appOwnerId: AppOwner["id"]): string =>
  `linky.shards.awaitingFirstHydration.${appOwnerId}`;

const newHydrationMarker = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Marks the account of `appMnemonic` as adopted by this device, so its store
 * holds every write until the account first hydrates. Call it on restore or
 * before clearing local data, before the store opens. Each call writes a fresh
 * token so an already-open tab hydrating an older database cannot clear it.
 */
export const markAwaitingFirstHydration = (
  kv: KeyValueStorage,
  appMnemonic: string,
): void => {
  const owner = appOwnerFromMnemonic(appMnemonic);
  if (owner)
    kv.setItem(awaitingFirstHydrationKey(owner.id), newHydrationMarker());
};

// Without any Evolu relay, only a device awaiting its first hydration stays unhydrated.
const withNoRelaySync = (
  db: ShardDb<LinkyDbSchema>,
  synced: boolean,
): ShardDb<LinkyDbSchema> => ({
  ...db,
  isOwnerSynced: () => synced,
  subscribeOwnerSync: () => () => {},
});

/**
 * The account's store, holding every write while the device awaits the
 * account's first hydration; hydration ends the wait for good.
 */
export const createAccountStore = (
  db: ShardDb<LinkyDbSchema>,
  appOwner: AppOwner,
  {
    kv,
    hasEvoluRelay,
    ...options
  }: {
    readonly kv: KeyValueStorage;
    readonly scopes?: LinkyScopes;
    readonly retention?: ShardRetention;
    readonly hasEvoluRelay: boolean;
  },
): LinkyStore => {
  const key = awaitingFirstHydrationKey(appOwner.id);
  const marker = kv.getItem(key);
  const awaitingFirstHydration = marker !== null && marker !== "";
  const store = createLinkyStore(
    hasEvoluRelay ? db : withNoRelaySync(db, !awaitingFirstHydration),
    appOwner,
    { ...options, holdWritesUntilHydrated: awaitingFirstHydration },
  );
  if (awaitingFirstHydration)
    store.subscribeHydration(() => {
      if (kv.getItem(key) === marker) kv.removeItem(key);
    });
  return store;
};
