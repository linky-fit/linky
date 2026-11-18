import * as Evolu from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IssueResolution } from "./issueState";

// Evolu 7's NonEmptyString100, which Evolu 8 dropped.
const IssueKey = Evolu.maxLength(100)(Evolu.minLength(1)(Evolu.String));

const schema = {
  issueResolution: {
    id: Evolu.id("IssueResolution"),
    issueKey: IssueKey,
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

const run = createRun(createEvoluDeps());

const query = Evolu.createQueryBuilder(schema)((db) =>
  db
    .selectFrom("issueResolution")
    .select(["issueKey", "solvedAtMs", "cutoffSec"])
    .where("isDeleted", "is not", Evolu.sqliteTrue),
);

const saveFailed = () =>
  new Error("Could not save the solved issue. Reload and try again.");

export const createTrackerStore = (ownerMnemonic: string) => {
  const mnemonic = Evolu.Mnemonic.fromUnknown(ownerMnemonic);
  if (!mnemonic.ok)
    throw new Error("Could not derive the issue database owner.");
  const ownerSecret = Evolu.mnemonicToOwnerSecret(mnemonic.value);
  const owner = Evolu.createAppOwner(ownerSecret);
  ownerSecret.fill(0);
  const evolu = run.ok(
    Evolu.createEvolu(schema, {
      appName: Evolu.AppName.orThrow("linky-errors"),
      evolu7Name: Evolu.Name.orThrow(`linky-errors-${owner.id}`),
      appOwner: owner,
      transports: EVOLU_SERVERS.flatMap((url) => {
        const parsed = Evolu.WebSocketUrlFromString.fromUnknown(url);
        return parsed.ok ? [{ type: "WebSocket", url: parsed.value }] : [];
      }),
    }),
  );
  return {
    evolu,
    solve: async (resolution: IssueResolution): Promise<void> => {
      const instance = await evolu;
      const issueKey = IssueKey.fromUnknown(resolution.issueKey);
      const solvedAtMs = Evolu.PositiveInt.fromUnknown(resolution.solvedAtMs);
      const cutoffSec = Evolu.PositiveInt.fromUnknown(resolution.cutoffSec);
      if (
        run.deps.evoluError.get() ||
        !issueKey.ok ||
        !solvedAtMs.ok ||
        !cutoffSec.ok
      )
        throw saveFailed();
      await new Promise<void>((resolve, reject) => {
        instance.insert(
          "issueResolution",
          {
            issueKey: issueKey.value,
            solvedAtMs: solvedAtMs.value,
            cutoffSec: cutoffSec.value,
          },
          { onSuccess: resolve, onError: () => reject(saveFailed()) },
        );
      });
    },
  };
};

export type TrackerStore = ReturnType<typeof createTrackerStore>;
type TrackerEvolu = Awaited<TrackerStore["evolu"]>;

const noRows: Evolu.QueryRows<typeof query.Row> = [];

export const useIssueResolutions = (store: TrackerStore) => {
  const [loaded, setLoaded] = useState<{
    readonly store: TrackerStore;
    readonly evolu: TrackerEvolu;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void store.evolu
      .then(async (evolu) => {
        await evolu.loadQuery(query);
        if (active) setLoaded({ store, evolu });
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [store]);
  const evolu = loaded?.evolu ?? null;
  const rows = useSyncExternalStore(
    useMemo(
      () => (evolu ? evolu.subscribeQuery(query) : () => () => {}),
      [evolu],
    ),
    useMemo(() => () => (evolu ? evolu.getQueryRows(query) : noRows), [evolu]),
  );
  const databaseError = useSyncExternalStore(
    run.deps.evoluError.subscribe,
    run.deps.evoluError.get,
  );
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
    ready: loaded?.store === store,
    error:
      databaseError || loadFailed
        ? "The solved-issue database could not be updated. Reload and try again."
        : null,
    solve: store.solve,
  };
};
