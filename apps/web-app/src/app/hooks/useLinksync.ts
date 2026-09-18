import {
  makeTransactionsRepository,
  type LinkyStore,
  type TransactionRecord,
  type TransactionsRepository,
} from "@linky/linksync";
import { useRepositoryRows, useVisibleShards } from "@linky/linksync/react";
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

/** Active index and owner ids of the transactions shards, kept current across rotations. */
export const useTransactionShards = () => {
  const shards = useVisibleShards(useLinkyStore(), "transactions");
  return React.useMemo(
    () => ({
      index: shards.at(-1)?.index ?? 0,
      ownerIds: shards.map((shard) => shard.owner.id),
    }),
    [shards],
  );
};

/** The debug page's manual rotation of the transactions shard. */
export const useTransactionsShardRotation = () => {
  const store = useLinkyStore();
  const [isBusy, setIsBusy] = React.useState(false);
  const rotate = React.useCallback(async () => {
    setIsBusy(true);
    try {
      await Effect.runPromise(store.rotate("transactions"));
    } catch (error) {
      reportAppLog({
        tag: "evolu.shardRotationFailed",
        summary: "Manual rotation of the transactions shard failed",
        payload: { error: getUnknownErrorMessage(error, "unknown") },
      });
    } finally {
      setIsBusy(false);
    }
  }, [store]);
  return { isBusy, rotate };
};
