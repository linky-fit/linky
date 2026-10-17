export { ContactId, TransactionId } from "./evoluIds";
import * as Evolu from "@evolu/common";
import {
  messageScopes,
  type CashuOperationId,
  type CashuProofId,
  type LinkyStore,
  type NostrIdentityId,
} from "@linky-fit/linksync";
import {
  type LinkyEvolu,
  generateDbNameFromMnemonic,
  LinkyEvoluSchema,
  markAwaitingFirstHydration,
  normalizeEvoluRelayUrl,
} from "@linky-fit/linksync/evolu";
import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeferredOnlineReady } from "./hooks/useDeferredOnlineReady";
import { evoluDatabaseBytes } from "./platform/evoluDatabaseSize";
import type { JsonValue } from "./types/json";
import { base64 } from "@scure/base";
import { localStorageKv } from "./utils/storage";
import { isRecord } from "./utils/unknown";
import { getInspectorEmissionEnabled } from "./devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "./devtools/inspector/reportInspectorRows";
import { reportAppLog } from "./devtools/inspector/appLog";
import { reportShardsSubscribed } from "./app/state/session/evoluInspector";
import { evoluAtom, evoluRelaySettingsAtom } from "./app/state/session/evolu";
import {
  emptyEvoluDatabaseInfo,
  evoluDatabaseInfoAtom,
  evoluLastErrorAtom,
  evoluServerProbesReadyAtom,
  evoluServersAtom,
} from "./app/state/session/evoluSettings";
import { sessionAtom, sessionSecrets } from "./app/state/session/session";

export type EvoluServerStatus = "checking" | "connected" | "disconnected";
export type EvoluError = Evolu.EvoluError;
export type EvoluErrorType = Evolu.EvoluError["type"];

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
};

const toJsonValue = (value: unknown): JsonValue => {
  if (isJsonValue(value)) return value;
  if (value === undefined) return null;
  return String(value);
};

type EvoluQueryRow = Record<string, unknown>;

const readCount = (rows: ReadonlyArray<EvoluQueryRow>): number | null => {
  const count = rows[0]?.count;
  return typeof count === "number" && Number.isFinite(count) && count >= 0
    ? count
    : null;
};

const toByteArray = (value: unknown): number[] => {
  if (value instanceof Uint8Array) return Array.from(value);
  const entries = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  if (entries.some((entry) => typeof entry !== "number")) return [];
  const out: number[] = [];
  for (const entry of entries) {
    if (typeof entry === "number") out.push(entry);
  }
  return out;
};

const toJsonRows = (
  rows: ReadonlyArray<EvoluQueryRow>,
): Record<string, JsonValue>[] =>
  rows.flatMap((row) => {
    const normalized: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = toJsonValue(value);
    }
    return [normalized];
  });

interface EvoluSelectBuilder {
  groupBy(columns: string[]): EvoluSelectBuilder;
  select(cb: (eb: EvoluExpressionBuilder) => unknown): EvoluSelectBuilder;
  selectAll(): EvoluSelectBuilder;
  orderBy(column: string, direction: string): EvoluSelectBuilder;
  limit(n: number): EvoluSelectBuilder;
  offset(n: number): EvoluSelectBuilder;
  where(column: string, operator: string, value: unknown): EvoluSelectBuilder;
}

interface EvoluExpressionBuilder {
  fn: {
    count(column: string): {
      as(name: string): unknown;
      distinct(): { as(name: string): unknown };
    };
    countAll(): { as(name: string): unknown };
  };
}

interface EvoluQueryBuilder {
  selectFrom(table: string): EvoluSelectBuilder;
}

const createUntypedQuery = (
  instance: LinkyEvolu,
  cb: (db: EvoluQueryBuilder) => EvoluSelectBuilder,
): unknown => {
  const fn = Reflect.get(Object(instance), "createQuery");
  if (typeof fn !== "function") return null;
  return fn.call(instance, cb);
};

const loadUntypedQueryRows = async (
  instance: LinkyEvolu,
  query: unknown,
): Promise<ReadonlyArray<EvoluQueryRow>> => {
  const fn = Reflect.get(Object(instance), "loadQuery");
  if (typeof fn !== "function") return [];
  try {
    const rows = await fn.call(instance, query);
    if (!Array.isArray(rows)) return [];
    const result: EvoluQueryRow[] = [];
    for (const row of rows) {
      if (isRecord(row)) result.push(row);
    }
    return result;
  } catch {
    return [];
  }
};

export const normalizeEvoluServerUrl = normalizeEvoluRelayUrl;

const probeWebSocketConnection = (
  url: string,
  timeoutMs = 2500,
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    let ws: WebSocket | null = null;
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs);

    ws.addEventListener("open", () => {
      window.clearTimeout(timer);
      finish(true);
    });

    ws.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(false);
    });

    ws.addEventListener("close", () => {
      window.clearTimeout(timer);
      finish(false);
    });
  });
};

export type { CashuTokenId } from "@linky-fit/linksync/evolu";
export type { CashuOperationId, CashuProofId, NostrIdentityId };

/** The database schema, legacy lane tables included; see `LinkyEvoluSchema`. */
export const Schema = LinkyEvoluSchema;

/** The signed-in session's database; only the authenticated shell renders this. */
export const useLinkyEvolu = (): LinkyEvolu => {
  const opened = useAtomValue(evoluAtom);
  if (opened === null) throw new Error("No Evolu database while signed out");
  return opened.evolu;
};

/** The session's app mnemonic, which names the database. */
const useAppMnemonic = (): string | null =>
  sessionSecrets(useAtomValue(sessionAtom))?.appMnemonic ?? null;

export const forgetChatShards = async (store: LinkyStore) => {
  const forgotten = (
    await Effect.runPromise(
      Effect.forEach(messageScopes, (scope) =>
        Effect.map(store.forget(scope), (shards) =>
          shards.map((shard) => ({
            ...shard,
            owner: store.shardOwner(scope, shard.index).id,
          })),
        ),
      ),
    )
  ).flat();
  if (getInspectorEmissionEnabled()) {
    reportInspectorRows([
      {
        at: Date.now(),
        channel: "evolu.sync",
        tag: "ShardsForgotten",
        summary: `Forgot ${forgotten.length} old chat shards locally`,
        links: { owner: forgotten.map(({ owner }) => owner) },
        payload: forgotten,
      },
    ]);
    reportShardsSubscribed(
      "forget",
      (await Effect.runPromise(store.syncOwners())).map((owner) => owner.id),
    );
  }
  return forgotten;
};

/** Resolves once the local database has answered a query. */
export const probeLocalDatabase = (evolu: LinkyEvolu): Promise<void> =>
  evolu
    .loadQuery(
      evolu.createQuery((db) =>
        db.selectFrom("ownerMeta").select("id").limit(1),
      ),
    )
    .then(() => undefined);

export const createOwnerMetaAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("ownerMeta").selectAll());
export const createNostrIdentitiesAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("nostrIdentity").selectAll());
export const createCashuTokensAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) =>
    db.selectFrom("cashuToken").selectAll().orderBy("createdAt", "desc"),
  );

export const createCashuProofsAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("cashuProof").selectAll());
export const createCashuOperationsAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("cashuOperation").selectAll());

export const createContactsAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("contact").selectAll());
export const createNostrMessagesAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("nostrMessage").selectAll());
export const createNostrReactionsAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("nostrReaction").selectAll());
export const createTransactionsAllQuery = (evolu: LinkyEvolu) =>
  evolu.createQuery((db) => db.selectFrom("transaction").selectAll());
/** A `contact` row with its legacy chat columns; read only by the lane migration. */
export type LegacyContactRow = Evolu.InferRow<
  ReturnType<typeof createContactsAllQuery>
>;
export type NostrMessageRow = Evolu.InferRow<
  ReturnType<typeof createNostrMessagesAllQuery>
>;
export type NostrReactionRow = Evolu.InferRow<
  ReturnType<typeof createNostrReactionsAllQuery>
>;
export type TransactionRow = Evolu.InferRow<
  ReturnType<typeof createTransactionsAllQuery>
>;

export type CashuTokenRow = Evolu.InferRow<
  ReturnType<typeof createCashuTokensAllQuery>
>;
export type CashuProofRow = Evolu.InferRow<
  ReturnType<typeof createCashuProofsAllQuery>
>;
export type CashuOperationRow = Evolu.InferRow<
  ReturnType<typeof createCashuOperationsAllQuery>
>;
export type OwnerMetaRow = Evolu.InferRow<
  ReturnType<typeof createOwnerMetaAllQuery>
>;
export type NostrIdentityRow = Evolu.InferRow<
  ReturnType<typeof createNostrIdentitiesAllQuery>
>;

/** Keeps `evoluLastErrorAtom` current and reports each error; mounted once by the shell. */
export const useEvoluLastError = (opts?: {
  logToConsole?: boolean;
}): Evolu.EvoluError | null => {
  const logToConsole = opts?.logToConsole ?? false;
  const evolu = useLinkyEvolu();
  const [lastError, setLastError] = useAtom(evoluLastErrorAtom);

  useEffect(() => {
    const unsub = evolu.subscribeError(() => {
      const err = evolu.getError();
      setLastError(err);
      if (!err) return;
      if (logToConsole) console.log("[linky][evolu] error", err.type);
      if (getInspectorEmissionEnabled()) {
        reportInspectorRows([
          {
            at: Date.now(),
            channel: "evolu.sync",
            tag: "EvoluError",
            summary: `Evolu reported ${err.type}`,
            links: "ownerId" in err ? { owner: err.ownerId } : {},
            payload: { type: err.type },
          },
        ]);
      }
    });

    return () => {
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, [evolu, logToConsole, setLastError]);

  return lastError;
};

const getEvoluDatabaseInfo = async (
  evolu: LinkyEvolu,
  mnemonic: string | null,
  isCurrent: () => boolean,
): Promise<{
  bytes: number;
  tableCounts: Record<string, number | null>;
  historyCount: number | null;
}> => {
  const tables = [
    "contact",
    "conversation",
    "message",
    "reaction",
    "unknownSenderMessage",
    "cashuToken",
    "cashuProof",
    "cashuOperation",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
    "recurringPayment",
    "keryxSubscription",
    "ownerMeta",
    "shardPointer",
    "setting",
  ] as const;

  const dbBytesPromise = evoluDatabaseBytes(
    generateDbNameFromMnemonic(mnemonic),
  );

  const tableCountsPromise = (async () => {
    const out: Record<string, number | null> = {};
    for (const table of tables) {
      if (!isCurrent()) break;
      try {
        const q = createUntypedQuery(evolu, (db) =>
          db.selectFrom(table).select((eb) => eb.fn.countAll().as("count")),
        );
        const rows = await loadUntypedQueryRows(evolu, q);
        out[table] = readCount(rows);
      } catch {
        out[table] = null;
      }
    }
    return out;
  })();

  // Count history entries (time travel mutations)
  const historyCountPromise = (async () => {
    try {
      const q = createUntypedQuery(evolu, (db) =>
        db
          .selectFrom("evolu_history")
          .select((eb) => eb.fn.countAll().as("count")),
      );
      const rows = await loadUntypedQueryRows(evolu, q);
      return readCount(rows);
    } catch {
      return null;
    }
  })();

  const [bytes, tableCounts, historyCount] = await Promise.all([
    dbBytesPromise,
    tableCountsPromise,
    historyCountPromise,
  ]);

  return { bytes, tableCounts, historyCount };
};

const uint8ArrayToBase64 = (bytes: unknown): string =>
  base64.encode(Uint8Array.from(toByteArray(bytes)));

const timestampToMs = (timestampBytes: unknown): number | null => {
  const arr = toByteArray(timestampBytes);
  if (arr.length < 8) return null;

  try {
    let millis = 0;
    for (let i = 0; i < 6; i++) {
      millis = millis * 256 + arr[i];
    }
    return Number.isFinite(millis) && millis > 0 ? millis : null;
  } catch {
    return null;
  }
};

// Helper to convert timestamp bytes to readable date
// Evolu timestamp format: 16 bytes, hybrid logical clock (HLC)
// First 8 bytes: [millis (48 bits) + counter (16 bits)] in big-endian
// Reference: https://evolu.dev/docs/how-evolu-works
const timestampToDate = (timestampBytes: unknown): string => {
  const millis = timestampToMs(timestampBytes);
  if (millis === null) return "";
  try {
    const date = new Date(millis);
    if (isNaN(date.getTime())) return "Invalid timestamp";
    return date.toLocaleString("cs-CZ");
  } catch (err) {
    console.error("Timestamp conversion error:", err);
    return "Invalid timestamp";
  }
};

/** Row shape returned by loadEvoluHistoryData. */
export interface EvoluHistoryRow {
  table: string;
  column: string;
  id: string;
  value: JsonValue;
  timestamp: string;
  [key: string]: JsonValue;
}

export const subscribeEvoluHistoryMutationVersion = (
  evolu: LinkyEvolu,
  listener: () => void,
): (() => void) => {
  const q = createUntypedQuery(evolu, (db) =>
    db.selectFrom("evolu_history").select((eb) => eb.fn.countAll().as("count")),
  );
  const subscribeQuery = Reflect.get(Object(evolu), "subscribeQuery");
  if (typeof subscribeQuery !== "function") return () => {};
  const subscribe = Reflect.apply(subscribeQuery, evolu, [q]);
  if (typeof subscribe !== "function") return () => {};
  const unsubscribe = Reflect.apply(subscribe, undefined, [listener]);
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
};

export const loadEvoluHistoryData = async (
  evolu: LinkyEvolu,
  limit = 100,
  offset = 0,
): Promise<EvoluHistoryRow[]> => {
  try {
    const q = createUntypedQuery(evolu, (db) =>
      db
        .selectFrom("evolu_history")
        .selectAll()
        .orderBy("timestamp", "desc")
        .limit(limit)
        .offset(offset),
    );
    const rows = await loadUntypedQueryRows(evolu, q);
    const rawRows = toJsonRows(rows);
    const formattedRows: EvoluHistoryRow[] = rawRows.map((row) => ({
      ...row,
      table: String(row.table ?? ""),
      column: String(row.column ?? ""),
      ownerId: uint8ArrayToBase64(row.ownerId),
      id: uint8ArrayToBase64(row.id),
      value: toJsonValue(row.value),
      timestamp: timestampToDate(row.timestamp),
    }));
    return formattedRows;
  } catch (err) {
    console.error("Failed to load evolu_history:", err);
    return [];
  }
};

export const loadEvoluCurrentData = async (
  evolu: LinkyEvolu,
): Promise<Record<string, Record<string, JsonValue>[]>> => {
  const tables = [
    "contact",
    "conversation",
    "message",
    "reaction",
    "unknownSenderMessage",
    "cashuToken",
    "cashuProof",
    "cashuOperation",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
    "recurringPayment",
    "keryxSubscription",
    "ownerMeta",
    "shardPointer",
    "setting",
  ] as const;

  const result: Record<string, Record<string, JsonValue>[]> = {};

  for (const table of tables) {
    try {
      const q = createUntypedQuery(evolu, (db) =>
        db.selectFrom(table).selectAll().limit(100),
      );
      const rows = await loadUntypedQueryRows(evolu, q);
      result[table] = toJsonRows(rows);
    } catch {
      result[table] = [];
    }
  }

  return result;
};

/** Hard-wipes the local Evolu storage (journal and state) and reloads. */
export const useWipeEvoluStorage = (): (() => void) => {
  const evolu = useLinkyEvolu();
  const mnemonic = useAppMnemonic();
  return useCallback(() => {
    const mnemonicResult = Evolu.Mnemonic.fromUnknown(mnemonic);
    if (!mnemonicResult.ok) {
      throw new Error("Missing stored mnemonic");
    }

    markAwaitingFirstHydration(localStorageKv, mnemonicResult.value);
    void evolu.restoreAppOwner(mnemonicResult.value, { reload: true });
  }, [evolu, mnemonic]);
};

export const useEvoluDatabaseInfoState = (opts?: {
  enabled?: boolean;
  onError?: (err: unknown) => void;
}) => {
  const enabled = opts?.enabled ?? true;
  const onError = opts?.onError;
  const evolu = useLinkyEvolu();
  const mnemonic = useAppMnemonic();

  const [info, setInfo] = useAtom(evoluDatabaseInfoAtom);
  const [isBusy, setIsBusy] = useState(false);
  const refreshing = useRef(false);
  const refreshRequested = useRef(false);
  const refreshGeneration = useRef(0);
  const queryFailed = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || queryFailed.current) return;
    refreshRequested.current = true;
    if (refreshing.current) return;
    refreshing.current = true;
    const generation = ++refreshGeneration.current;
    setIsBusy(true);
    try {
      do {
        refreshRequested.current = false;
        const next = await getEvoluDatabaseInfo(
          evolu,
          mnemonic,
          () => generation === refreshGeneration.current,
        );
        if (generation !== refreshGeneration.current) return;
        setInfo({ ...next, updatedAtMs: Date.now() });
      } while (refreshRequested.current);
    } catch (err) {
      if (generation === refreshGeneration.current) onError?.(err);
    } finally {
      if (generation === refreshGeneration.current) {
        refreshing.current = false;
        setIsBusy(false);
      }
    }
  }, [enabled, evolu, mnemonic, onError, setInfo]);

  useEffect(() => {
    if (!enabled) return;
    if (queryFailed.current) return;
    const cancelRefresh = () => {
      refreshGeneration.current += 1;
      refreshing.current = false;
      refreshRequested.current = false;
      setIsBusy(false);
    };
    let unsubscribe = () => {};
    const unsubscribeError = evolu.subscribeError(() => {
      const error = evolu.getError();
      if (error?.type !== "SqliteError") return;
      // Evolu leaves a failed loadQuery promise cached and unresolved until reload.
      queryFailed.current = true;
      unsubscribe();
      cancelRefresh();
      setInfo(emptyEvoluDatabaseInfo);
      onError?.(error);
    });
    unsubscribe = subscribeEvoluHistoryMutationVersion(evolu, () => {
      void refresh();
    });
    void refresh();
    return () => {
      unsubscribe();
      unsubscribeError();
      cancelRefresh();
    };
  }, [enabled, evolu, onError, refresh, setInfo]);

  return {
    info,
    isBusy,
    refresh,
  } as const;
};

/** The device's Evolu relays and their last probe, with the edits Settings makes. */
export const useEvoluServers = () => {
  const evoluRelaySettings = useAtomValue(evoluRelaySettingsAtom);
  const [servers, setServers] = useAtom(evoluServersAtom);
  const canRunNetworkWork = useAtomValue(evoluServerProbesReadyAtom);

  const disabledLower = useMemo(() => {
    const s = new Set<string>();
    for (const u of servers.disabledUrls) s.add(u.toLowerCase());
    return s;
  }, [servers.disabledUrls]);

  const isOffline = useCallback(
    (url: string): boolean => disabledLower.has(url.toLowerCase()),
    [disabledLower],
  );

  const activeUrls = useMemo(
    () => servers.configuredUrls.filter((u) => !isOffline(u)),
    [isOffline, servers.configuredUrls],
  );

  const changeServers = useCallback(
    (apply: () => void) => {
      apply();
      setServers((current) => ({
        ...current,
        configuredUrls: [...evoluRelaySettings.configuredUrls()],
        disabledUrls: [...evoluRelaySettings.disabledUrls()],
        reloadRequired: true,
      }));
    },
    [evoluRelaySettings, setServers],
  );

  const setServerUrls = useCallback(
    (nextUrls: string[]) =>
      changeServers(() => {
        evoluRelaySettings.setUrls(nextUrls);
        if (getInspectorEmissionEnabled()) {
          reportAppLog({
            tag: "evolu.serversChanged",
            summary: "Updated Evolu servers; reload required",
            payload: {
              configuredUrls: evoluRelaySettings.configuredUrls(),
              activeUrls: evoluRelaySettings.activeUrls(),
            },
          });
        }
      }),
    [changeServers, evoluRelaySettings],
  );

  const setServerOffline = useCallback(
    (url: string, offline: boolean) =>
      changeServers(() => evoluRelaySettings.setDisabled(url, offline)),
    [changeServers, evoluRelaySettings],
  );

  const effectiveStatusByUrl = useMemo(() => {
    if (canRunNetworkWork) return servers.statusByUrl;

    const next = { ...servers.statusByUrl };
    for (const url of activeUrls) {
      next[url] = "disconnected";
    }
    return next;
  }, [activeUrls, canRunNetworkWork, servers.statusByUrl]);

  return {
    configuredUrls: servers.configuredUrls,
    activeUrls,
    statusByUrl: effectiveStatusByUrl,
    reloadRequired: servers.reloadRequired,
    setServerUrls,
    isOffline,
    isRecommended: evoluRelaySettings.isRecommended,
    setServerOffline,
  } as const;
};

/** Probes the active Evolu relays every 15 s; mounted once by the shell. */
export const useEvoluServerProbes = (opts?: {
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}): void => {
  const probeIntervalMs = opts?.probeIntervalMs ?? 15000;
  const probeTimeoutMs = opts?.probeTimeoutMs ?? 3500;
  const canRunNetworkWork = useDeferredOnlineReady();
  const { activeUrls } = useEvoluServers();
  const setServers = useAtomSet(evoluServersAtom);
  const setProbesReady = useAtomSet(evoluServerProbesReadyAtom);

  useEffect(() => {
    setProbesReady(canRunNetworkWork);
  }, [canRunNetworkWork, setProbesReady]);

  useEffect(() => {
    if (activeUrls.length === 0) return;
    if (!canRunNetworkWork) return;

    let cancelled = false;
    const setStatusByUrl = (
      update: (
        prev: Readonly<Record<string, EvoluServerStatus>>,
      ) => Readonly<Record<string, EvoluServerStatus>>,
    ) =>
      setServers((current) => {
        const statusByUrl = update(current.statusByUrl);
        return statusByUrl === current.statusByUrl
          ? current
          : { ...current, statusByUrl };
      });

    const run = async () => {
      // Only urls with no known status get a visible "checking" state; known
      // urls keep their last status during background re-probes so steady-state
      // polls don't re-render the app when nothing changed.
      setStatusByUrl((prev) => {
        const missing = activeUrls.filter((url) => prev[url] === undefined);
        if (missing.length === 0) return prev;
        const next = { ...prev };
        for (const url of missing) next[url] = "checking";
        return next;
      });

      const results = await Promise.all(
        activeUrls.map(async (url) => {
          const ok = await probeWebSocketConnection(url, probeTimeoutMs);
          return [url, ok] as const;
        }),
      );

      if (cancelled) return;
      setStatusByUrl((prev) => {
        const changed = results.filter(
          ([url, ok]) => prev[url] !== (ok ? "connected" : "disconnected"),
        );
        if (changed.length === 0) return prev;
        const next = { ...prev };
        for (const [url, ok] of changed)
          next[url] = ok ? "connected" : "disconnected";
        return next;
      });
    };

    void run();
    const intervalId = window.setInterval(run, probeIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeUrls,
    canRunNetworkWork,
    probeIntervalMs,
    probeTimeoutMs,
    setServers,
  ]);
};
