import {
  appOwnerFromMnemonic,
  createLinkyStore,
  type AppOwner,
  type LinkyDbSchema,
  type LinkyScopes,
  type LinkyStore,
  type ShardDb,
  type ShardRetention,
} from "@linky-fit/linksync";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "./utils/storage";

/** Set while this device holds an account it adopted whose data, shard pointers included, has not arrived yet. */
const awaitingFirstHydrationKey = (appOwnerId: AppOwner["id"]): string =>
  `linky.shards.awaitingFirstHydration.${appOwnerId}`;

export const markAwaitingFirstHydration = (appMnemonic: string): void => {
  const owner = appOwnerFromMnemonic(appMnemonic);
  if (owner) safeLocalStorageSet(awaitingFirstHydrationKey(owner.id), "1");
};

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
    hasEvoluRelay,
    ...options
  }: {
    readonly scopes?: LinkyScopes;
    readonly retention?: ShardRetention;
    readonly hasEvoluRelay: boolean;
  },
): LinkyStore => {
  const key = awaitingFirstHydrationKey(appOwner.id);
  const awaitingFirstHydration = safeLocalStorageGet(key) === "1";
  const store = createLinkyStore(
    awaitingFirstHydration && !hasEvoluRelay ? withoutOwnerSync(db) : db,
    appOwner,
    { ...options, holdWritesUntilHydrated: awaitingFirstHydration },
  );
  if (awaitingFirstHydration)
    store.subscribeHydration(() => safeLocalStorageRemove(key));
  return store;
};
