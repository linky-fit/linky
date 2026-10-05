import type { OwnerId, SimpleName, Worker } from "@evolu/common";
import type { CreateDbWorker } from "@evolu/common/local-first";
import type {
  EvoluRelayStatus,
  OwnerSyncFailed,
  PageMessage,
  WorkerMessage,
} from "./dbWorker";

export type OwnerSyncFailure = Omit<OwnerSyncFailed, "type">;

/** Owners whose sync round with a relay finished since the database worker started. */
export interface OwnerSync {
  readonly syncedOwners: () => ReadonlySet<OwnerId>;
  readonly subscribe: (listener: () => void) => () => void;
  /** Hears each protocol error a relay answers while this page is open. */
  readonly subscribeFailures: (
    listener: (failure: OwnerSyncFailure) => void,
  ) => () => void;
  /** Each relay socket's latest status, keyed by relay url; empty until the worker opened one. */
  readonly relayStatuses: () => Readonly<Record<string, EvoluRelayStatus>>;
  readonly subscribeRelayStatuses: (listener: () => void) => () => void;
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
  let relayStatuses: Readonly<Record<string, EvoluRelayStatus>> = {};
  const relayStatusListeners = new Set<() => void>();
  const listen =
    <L>(set: Set<L>) =>
    (listener: L) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  return {
    createDbWorker: (name) => {
      const worker = createWorker(name);
      worker.postMessage({ type: "linksync.ownersSyncedRequest" });
      return {
        postMessage: worker.postMessage,
        onMessage: (callback) =>
          worker.onMessage((message) => {
            if (message.type === "linksync.ownerSyncFailed") {
              for (const listener of failureListeners) listener(message);
              return;
            }
            if (message.type === "linksync.relayStatuses") {
              relayStatuses = message.statuses;
              for (const listener of relayStatusListeners) listener();
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
      subscribe: listen(listeners),
      subscribeFailures: listen(failureListeners),
      relayStatuses: () => relayStatuses,
      subscribeRelayStatuses: listen(relayStatusListeners),
    },
  };
};
