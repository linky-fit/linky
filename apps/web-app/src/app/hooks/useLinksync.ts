import {
  linkyScopes,
  makeContactsRepository,
  makeConversationsRepository,
  makeIdentityRepository,
  makeSettingsRepository,
  makeTransactionsRepository,
  makeWalletRepository,
  type ContactRow,
  type ContactsRepository,
  type ConversationRow,
  type ConversationsRepository,
  type IdentityRepository,
  type LinkyScope,
  type LinkyStore,
  type MessageRow,
  type NostrIdentityRow,
  type ReactionRow,
  type SettingsRepository,
  type TransactionRecord,
  type TransactionsRepository,
  type WalletRepository,
} from "@linky/linksync";
import { useLiveValue, useRepositoryRows } from "@linky/linksync/react";
import type { StoredOperation, StoredProof } from "@linky/linkshu";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getLinkyStore } from "../../evolu";
import { getUnknownErrorMessage } from "../../utils/unknown";

/** The shard store; resolved before the authenticated shell mounts, so this reads synchronously there. */
export const useLinkyStore = (): LinkyStore => React.use(getLinkyStore());

export const useContactsRepository = (): ContactsRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeContactsRepository(store), [store]);
};

export const useContactRows = (): ReadonlyArray<ContactRow> =>
  useRepositoryRows(useContactsRepository());

export const useConversationsRepository = (): ConversationsRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeConversationsRepository(store), [store]);
};

export const useConversationRows = (): ReadonlyArray<ConversationRow> =>
  useRepositoryRows(useConversationsRepository());

export const useMessageRows = (): ReadonlyArray<MessageRow> =>
  useRepositoryRows(useConversationsRepository().messages);

export const useReactionRows = (): ReadonlyArray<ReactionRow> =>
  useRepositoryRows(useConversationsRepository().reactions);

export const useIdentityRepository = (): IdentityRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeIdentityRepository(store), [store]);
};

/** The synced active Nostr identity row, kept current; null until one syncs. */
export const useSyncedNostrIdentityRow = (): NostrIdentityRow | null => {
  const { current, subscribe } = useIdentityRepository();
  const source = React.useMemo(
    () => ({ all: current, subscribe }),
    [current, subscribe],
  );
  return useLiveValue<NostrIdentityRow | null>(source, null);
};

export const useSettingsRepository = (): SettingsRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeSettingsRepository(store), [store]);
};

/** One synced setting value, kept current; `null` until read or when absent. */
export const useSetting = (key: string): string | null => {
  const settings = useSettingsRepository();
  const source = React.useMemo(
    () => ({ all: settings.get(key), subscribe: settings.subscribe }),
    [key, settings],
  );
  return useLiveValue<string | null>(source, null);
};

export const useTransactionsRepository = (): TransactionsRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeTransactionsRepository(store), [store]);
};

export const useTransactionRecords = (): ReadonlyArray<TransactionRecord> =>
  useRepositoryRows(useTransactionsRepository());

/** linkshu's stores over the cashu shards; the wallet runtime is built on it. */
export const useWalletRepository = (): WalletRepository => {
  const store = useLinkyStore();
  return React.useMemo(() => makeWalletRepository(store), [store]);
};

const NO_PROOFS: ReadonlyArray<StoredProof> = [];
const NO_OPERATIONS: ReadonlyArray<StoredOperation> = [];

/** The stored proofs, kept current, for code outside the wallet runtime. */
export const useWalletProofs = (): ReadonlyArray<StoredProof> => {
  const wallet = useWalletRepository();
  const source = React.useMemo(
    () => ({ all: wallet.proofs.loadAll, subscribe: wallet.subscribe }),
    [wallet],
  );
  return useLiveValue(source, NO_PROOFS);
};

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
