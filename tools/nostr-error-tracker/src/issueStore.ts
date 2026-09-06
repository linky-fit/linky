import * as Evolu from "@evolu/common";
import { evoluReactWebDeps } from "@evolu/react-web";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IssueResolution } from "./issueState";

const schema = {
  issueResolution: {
    id: Evolu.id("IssueResolution"),
    issueKey: Evolu.NonEmptyString100,
    solvedAtMs: Evolu.PositiveInt,
    cutoffSec: Evolu.PositiveInt,
  },
};

const configuredServers = (import.meta.env.VITE_EVOLU_SERVER_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));

export const EVOLU_SERVERS = configuredServers.length
  ? configuredServers
  : ["wss://evolu.linky.fit"];

export const createTrackerStore = (ownerMnemonic: string) => {
  const mnemonic = Evolu.Mnemonic.fromUnknown(ownerMnemonic);
  if (!mnemonic.ok)
    throw new Error("Could not derive the issue database owner.");
  const ownerSecret = Evolu.mnemonicToOwnerSecret(mnemonic.value);
  const owner = Evolu.createAppOwner(ownerSecret);
  ownerSecret.fill(0);
  const evolu = Evolu.createEvolu(evoluReactWebDeps)(schema, {
    name: Evolu.SimpleName.orThrow(`linky-errors-${owner.id}`),
    externalAppOwner: owner,
    transports: EVOLU_SERVERS.map((url) => ({ type: "WebSocket", url })),
  });
  const query = evolu.createQuery((db) =>
    db
      .selectFrom("issueResolution")
      .select(["issueKey", "solvedAtMs", "cutoffSec"])
      .where("isDeleted", "is not", Evolu.sqliteTrue),
  );
  return {
    evolu,
    query,
    solve: (resolution: IssueResolution): Promise<void> =>
      new Promise((resolve, reject) => {
        if (evolu.getError()) {
          reject(
            new Error("Could not save the solved issue. Reload and try again."),
          );
          return;
        }
        const unsubscribe = evolu.subscribeError(() => {
          if (!evolu.getError()) return;
          unsubscribe();
          reject(
            new Error("Could not save the solved issue. Reload and try again."),
          );
        });
        const result = evolu.insert("issueResolution", resolution, {
          onComplete: () => {
            unsubscribe();
            resolve();
          },
        });
        if (!result.ok) {
          unsubscribe();
          reject(new Error("Could not save the solved issue."));
        }
      }),
  };
};

export type TrackerStore = ReturnType<typeof createTrackerStore>;

export const useIssueResolutions = (store: TrackerStore) => {
  const { evolu, query } = store;
  const rows = useSyncExternalStore(
    useMemo(() => evolu.subscribeQuery(query), [evolu, query]),
    useMemo(() => () => evolu.getQueryRows(query), [evolu, query]),
  );
  const databaseError = useSyncExternalStore(
    evolu.subscribeError,
    evolu.getError,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadedStore, setLoadedStore] = useState<TrackerStore | null>(null);
  useEffect(() => {
    let active = true;
    void evolu
      .loadQuery(query)
      .then(() => {
        if (active) setLoadedStore(store);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [evolu, query, store]);
  const resolutions = useMemo(
    (): readonly IssueResolution[] =>
      rows.flatMap((row) =>
        row.issueKey !== null &&
        row.solvedAtMs !== null &&
        row.cutoffSec !== null
          ? [
              {
                issueKey: row.issueKey,
                solvedAtMs: row.solvedAtMs,
                cutoffSec: row.cutoffSec,
              },
            ]
          : [],
      ),
    [rows],
  );
  return {
    resolutions,
    ready: loadedStore === store,
    error:
      databaseError || loadFailed
        ? "The solved-issue database could not be updated. Reload and try again."
        : null,
    solve: store.solve,
  };
};
