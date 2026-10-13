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

/**
 * Marks the account of `appMnemonic` as adopted by this device, so its store
 * holds every write until the account first hydrates. Call it on restore,
 * before the store opens.
 */
export const markAwaitingFirstHydration = (
  kv: KeyValueStorage,
  appMnemonic: string,
): void => {
  const owner = appOwnerFromMnemonic(appMnemonic);
  if (owner) kv.setItem(awaitingFirstHydrationKey(owner.id), "1");
};

/** Whether this device still awaits the first hydration of the account it adopted; see `markAwaitingFirstHydration`. */
export const isAwaitingFirstHydration = (
  kv: KeyValueStorage,
  appOwnerId: AppOwner["id"],
): boolean => kv.getItem(awaitingFirstHydrationKey(appOwnerId)) === "1";

// With no Evolu relay the worker counts every owner synced at once, though nothing of the account arrived.
const withoutOwnerSync = (
  db: ShardDb<LinkyDbSchema>,
): ShardDb<LinkyDbSchema> => ({
  ...db,
  isOwnerSynced: () => false,
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
  const awaitingFirstHydration = isAwaitingFirstHydration(kv, appOwner.id);
  const store = createLinkyStore(
    awaitingFirstHydration && !hasEvoluRelay ? withoutOwnerSync(db) : db,
    appOwner,
    { ...options, holdWritesUntilHydrated: awaitingFirstHydration },
  );
  if (awaitingFirstHydration)
    store.subscribeHydration(() =>
      kv.removeItem(awaitingFirstHydrationKey(appOwner.id)),
    );
  return store;
};
