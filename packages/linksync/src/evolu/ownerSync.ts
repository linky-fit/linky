import type { OwnerId, SimpleName, Worker } from "@evolu/common";
import type { CreateDbWorker } from "@evolu/common/local-first";
import type { PageMessage, WorkerMessage } from "./dbWorker";

/** A relay answered a request for the owner with a protocol error. */
export interface OwnerSyncFailure {
  readonly ownerId: OwnerId;
  /** Evolu's `ProtocolErrorCode` name, such as `QuotaError`. */
  readonly error: string;
  /** False while the relay has not yet answered the owner without an error; the owner then stays unsynced. */
  readonly endsRound: boolean;
}

/** Owners whose sync round with a relay finished since the database worker started. */
export interface OwnerSync {
  readonly syncedOwners: () => ReadonlySet<OwnerId>;
  readonly subscribe: (listener: () => void) => () => void;
  /** Hears each protocol error a relay answers while this page is open. */
  readonly subscribeFailures: (
    listener: (failure: OwnerSyncFailure) => void,
  ) => () => void;
}

/**
 * Wraps the page side of a database worker started with
 * `runOwnerSyncDbWorker`: Evolu gets the worker it expects, and
 * `ownerSync` collects the owners the worker reports, including the ones it
 * reported before this page opened.
 */
export const trackOwnerSync = (
  createWorker: (name: SimpleName) => Worker<PageMessage, WorkerMessage>,
): {
  readonly createDbWorker: CreateDbWorker;
  readonly ownerSync: OwnerSync;
} => {
  const synced = new Set<OwnerId>();
  const listeners = new Set<() => void>();
  const failureListeners = new Set<(failure: OwnerSyncFailure) => void>();
  return {
    createDbWorker: (name) => {
      const worker = createWorker(name);
      worker.postMessage({ type: "linksync.ownersSyncedRequest" });
      return {
        postMessage: worker.postMessage,
        onMessage: (callback) =>
          worker.onMessage((message) => {
            if (message.type === "linksync.ownerSyncFailed") {
              const { ownerId, error, endsRound } = message;
              for (const listener of failureListeners)
                listener({ ownerId, error, endsRound });
              return;
            }
            if (message.type !== "linksync.ownersSynced") {
              callback(message);
              return;
            }
            const fresh = message.ownerIds.filter((id) => !synced.has(id));
            if (fresh.length === 0) return;
            for (const id of fresh) synced.add(id);
            for (const listener of listeners) listener();
          }),
      };
    },
    ownerSync: {
      syncedOwners: () => synced,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      subscribeFailures: (listener) => {
        failureListeners.add(listener);
        return () => {
          failureListeners.delete(listener);
        };
      },
    },
  };
};
