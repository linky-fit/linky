import {
  makeTransactionsRepository,
  makeWalletRepository,
  type LinkyScope,
  type LinkyStore,
  type TransactionRecord,
  type TransactionsRepository,
  type WalletRepository,
} from "@linky/linksync";
import {
  useLiveValue,
  useRepositoryRows,
  useVisibleShards,
} from "@linky/linksync/react";
import type { StoredOperation, StoredProof } from "@linky/linkshu";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getLinkyStore } from "../../evolu";
import { getUnknownErrorMessage } from "../../utils/unknown";

/** The shard store; resolved before the authenticated shell mounts, so this reads synchronously there. */
export const useLinkyStore = (): LinkyStore => React.use(getLinkyStore());

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

/** Active index and owner ids of a scope's shards, kept current across rotations. */
export const useShardIds = (scope: LinkyScope) => {
  const shards = useVisibleShards(useLinkyStore(), scope);
  return React.useMemo(
    () => ({
      index: shards.at(-1)?.index ?? 0,
      ownerIds: shards.map((shard) => shard.owner.id),
    }),
    [shards],
  );
};

/** The debug page's manual rotation of a scope's shard. */
export const useShardRotation = (scope: LinkyScope) => {
  const store = useLinkyStore();
  const [isBusy, setIsBusy] = React.useState(false);
  const rotate = React.useCallback(async () => {
    setIsBusy(true);
    try {
      await Effect.runPromise(store.rotate(scope));
    } catch (error) {
      reportAppLog({
        tag: "evolu.shardRotationFailed",
        summary: `Manual rotation of the ${scope} shard failed`,
        payload: { scope, error: getUnknownErrorMessage(error, "unknown") },
      });
    } finally {
      setIsBusy(false);
    }
  }, [scope, store]);
  return { isBusy, rotate };
};
