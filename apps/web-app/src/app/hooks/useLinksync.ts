import {
  linkyScopes,
  type ContactRow,
  type ContactsRepository,
  type ConversationRow,
  type ConversationsRepository,
  type IdentityRepository,
  type InboxCursorsRepository,
  type KeryxSubscriptionRecord,
  type KeryxSubscriptionsRepository,
  type LinkyScope,
  type LinkyStore,
  type MessageRow,
  type NostrIdentityRow,
  type ReactionRow,
  type SettingKey,
  type RecurringPaymentRecord,
  type RecurringPaymentsRepository,
  type SettingsRepository,
  type SettingValues,
  type TransactionRecord,
  type TransactionsRepository,
  type UnknownSendersRepository,
  type WalletRepository,
} from "@linky-fit/linksync";
import {
  useHydrated,
  useLiveValue,
  useRepositoryRows,
} from "@linky-fit/linksync/react";
import type { StoredOperation } from "@linky-fit/linkshu";
import { useAtomSuspense } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../../utils/unknown";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
  identityRepositoryAtom,
  appOwnerIdAtom,
  inboxCursorsRepositoryAtom,
  keryxSubscriptionsRepositoryAtom,
  linkyStoreAtom,
  recurringPaymentsRepositoryAtom,
  settingsRepositoryAtom,
  transactionsRepositoryAtom,
  unknownSendersRepositoryAtom,
  walletRepositoryAtom,
} from "../state/session/store";

/** The session's shard store; suspends until the local database has answered. */
export const useLinkyStore = (): LinkyStore =>
  useAtomSuspense(linkyStoreAtom).value;

/** The session's app owner id; suspends like `useLinkyStore`. */
export const useAppOwnerId = (): string =>
  useAtomSuspense(appOwnerIdAtom).value;

export const useContactsRepository = (): ContactsRepository =>
  useAtomSuspense(contactsRepositoryAtom).value;

export const useContactRows = (): ReadonlyArray<ContactRow> =>
  useRepositoryRows(useContactsRepository());

export const useConversationsRepository = (): ConversationsRepository =>
  useAtomSuspense(conversationsRepositoryAtom).value;

export const useConversationRows = (): ReadonlyArray<ConversationRow> =>
  useRepositoryRows(useConversationsRepository());

export const useInboxCursorsRepository = (): InboxCursorsRepository =>
  useAtomSuspense(inboxCursorsRepositoryAtom).value;

export const useUnknownSendersRepository = (): UnknownSendersRepository =>
  useAtomSuspense(unknownSendersRepositoryAtom).value;

export const useMessageRows = (): ReadonlyArray<MessageRow> =>
  useRepositoryRows(useConversationsRepository().messages);

export const useReactionRows = (): ReadonlyArray<ReactionRow> =>
  useRepositoryRows(useConversationsRepository().reactions);

export const useIdentityRepository = (): IdentityRepository =>
  useAtomSuspense(identityRepositoryAtom).value;

/** The synced active Nostr identity row, kept current; null until one syncs. */
export const useSyncedNostrIdentityRow = (): NostrIdentityRow | null => {
  const { current, subscribe } = useIdentityRepository();
  const source = React.useMemo(
    () => ({ all: current, subscribe }),
    [current, subscribe],
  );
  return useLiveValue<NostrIdentityRow | null>(source, null);
};

export const useSettingsRepository = (): SettingsRepository =>
  useAtomSuspense(settingsRepositoryAtom).value;

/** One synced setting value, kept current; `null` until read or when absent. */
export const useSetting = <K extends SettingKey>(
  key: K,
): SettingValues[K] | null => {
  const settings = useSettingsRepository();
  const source = React.useMemo(
    () => ({ all: settings.get(key), subscribe: settings.subscribe }),
    [key, settings],
  );
  return useLiveValue<SettingValues[K] | null>(source, null);
};

export const useTransactionsRepository = (): TransactionsRepository =>
  useAtomSuspense(transactionsRepositoryAtom).value;

export const useTransactionRecords = (): ReadonlyArray<TransactionRecord> =>
  useRepositoryRows(useTransactionsRepository());

export const useRecurringPaymentsRepository = (): RecurringPaymentsRepository =>
  useAtomSuspense(recurringPaymentsRepositoryAtom).value;

export const useRecurringPaymentRecords =
  (): ReadonlyArray<RecurringPaymentRecord> =>
    useRepositoryRows(useRecurringPaymentsRepository());

export const useKeryxSubscriptionsRepository =
  (): KeryxSubscriptionsRepository =>
    useAtomSuspense(keryxSubscriptionsRepositoryAtom).value;

export const useKeryxSubscriptionRows =
  (): ReadonlyArray<KeryxSubscriptionRecord> =>
    useRepositoryRows(useKeryxSubscriptionsRepository());

/** linkshu's stores over the cashu shards; the wallet runtime is built on it. */
export const useWalletRepository = (): WalletRepository =>
  useAtomSuspense(walletRepositoryAtom).value;

const NO_OPERATIONS: ReadonlyArray<StoredOperation> = [];

export const useWalletOperations = (): ReadonlyArray<StoredOperation> => {
  const wallet = useWalletRepository();
  const source = React.useMemo(
    () => ({ all: wallet.operations.loadAll, subscribe: wallet.subscribe }),
    [wallet],
  );
  return useLiveValue(source, NO_OPERATIONS);
};

export interface ShardSummary {
  readonly scope: LinkyScope;
  readonly index: number;
  /** The active shard's owner id. */
  readonly ownerId: string;
  readonly visibleOwnerIds: ReadonlyArray<string>;
  readonly rotates: boolean;
}

const NO_SUMMARIES: ReadonlyArray<ShardSummary> = [];
const NO_OWNER_IDS: ReadonlyArray<string> = [];
const SCOPES = Object.keys(linkyScopes).filter((scope): scope is LinkyScope =>
  Object.hasOwn(linkyScopes, scope),
);

/** Index, owner ids and visible shard count of every scope, kept current across rotations. */
export const useShardSummaries = (): ReadonlyArray<ShardSummary> => {
  const store = useLinkyStore();
  const source = React.useMemo(
    () => ({
      all: Effect.forEach(SCOPES, (scope) =>
        Effect.map(
          store.visibleShards(scope),
          (shards): ShardSummary => ({
            scope,
            index: shards.at(-1)?.index ?? 0,
            ownerId: shards.at(-1)?.owner.id ?? "",
            visibleOwnerIds: shards.map((shard) => shard.owner.id),
            rotates:
              linkyScopes[scope].owner === "shard" &&
              linkyScopes[scope].rotation !== null,
          }),
        ),
      ),
      subscribe: store.subscribePointers,
    }),
    [store],
  );
  return useLiveValue(source, NO_SUMMARIES);
};

/** The owner ids the store syncs: the app owner and every visible shard. */
export const useSyncOwnerIds = (): ReadonlyArray<string> => {
  const store = useLinkyStore();
  const source = React.useMemo(
    () => ({
      all: Effect.map(store.syncOwners(), (owners) =>
        owners.map((owner) => owner.id),
      ),
      subscribe: store.subscribePointers,
    }),
    [store],
  );
  return useLiveValue(source, NO_OWNER_IDS);
};

/** The debug page's manual rotation of a scope's shard. */
export const useShardRotation = () => {
  const store = useLinkyStore();
  const [busyScope, setBusyScope] = React.useState<LinkyScope | null>(null);
  const rotate = React.useCallback(
    async (scope: LinkyScope) => {
      setBusyScope(scope);
      try {
        await Effect.runPromise(store.rotate(scope));
      } catch (error) {
        reportAppLog({
          tag: "evolu.shardRotationFailed",
          summary: `Manual rotation of the ${scope} shard failed`,
          payload: { scope, error: getUnknownErrorMessage(error, "unknown") },
        });
      } finally {
        setBusyScope(null);
      }
    },
    [store],
  );
  return { busyScope, rotate };
};

/** Whether the account's data has arrived from an Evolu relay; see `ShardStore.hydrated`. */
export const useAccountHydrated = (): boolean => useHydrated(useLinkyStore());
