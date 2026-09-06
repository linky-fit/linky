import { ContactId, TransactionId } from "./evoluIds";
export { ContactId, TransactionId } from "./evoluIds";
import { Schema as EffectSchema } from "effect";
import * as Evolu from "@evolu/common";
import { createEvolu, SimpleName } from "@evolu/common";
import { createUseEvolu, EvoluProvider } from "@evolu/react";
import { evoluReactWebDeps } from "@evolu/react-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeferredOnlineReady } from "./hooks/useDeferredOnlineReady";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "./mnemonic";
import { shouldUseInMemoryEvoluStorage } from "./platform/evoluWebStorage";
import type { JsonValue } from "./types/json";
import { base64 } from "@scure/base";
import { decodeBase64Url } from "./utils/base64";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "./utils/storage";
import { isRecord } from "./utils/unknown";
import { getInspectorEmissionEnabled } from "./devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "./devtools/inspector/reportInspectorRows";

const isEvoluLoggingEnabled = (): boolean => {
  if (!import.meta.env.DEV) return false;

  // Enable only when explicitly requested, because SQL logging is very noisy.
  // Toggle in devtools: localStorage.setItem('linky_debug_evolu_sql', '1')
  return safeLocalStorageGet("linky_debug_evolu_sql") === "1";
};

const EVOLU_SERVERS_STORAGE_KEY = "linky.evoluServers.v1";

// Backwards-compatible flag that allows removing the built-in default servers.
// Without this, we can only store "extras" and the defaults would always be re-added.
const EVOLU_SERVERS_DEFAULT_REMOVED_STORAGE_KEY =
  "linky.evoluServers.defaultRemoved.v1";

const EVOLU_SERVERS_DISABLED_STORAGE_KEY = "linky.evoluServers.disabled.v1";

export type EvoluServerStatus = "checking" | "connected" | "disconnected";

type EvoluDatabaseInfo = {
  bytes: number | null;
  tableCounts: Record<string, number | null>;
  historyCount: number | null;
  updatedAtMs: number | null;
};

const envEvoluServerUrls = (import.meta.env.VITE_EVOLU_SERVER_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));

const DEFAULT_EVOLU_SERVER_URLS: ReadonlyArray<string> =
  envEvoluServerUrls.length > 0
    ? envEvoluServerUrls
    : ["wss://evolu.linky.fit", "wss://free.evoluhq.com"];

// Generate a valid SimpleName (1-42 chars, alphanumeric + dash) from mnemonic
// Each user gets their own SQLite database file
const generateDbNameFromMnemonic = (mnemonic: string): string => {
  // Simple hash function to create a short unique identifier
  let hash = 0;
  for (let i = 0; i < mnemonic.length; i++) {
    const char = mnemonic.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to positive hex string, take first 8 chars for brevity
  const hashHex = Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
  return `linky-${hashHex}`;
};

type Stringifiable =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | { toString(): string }
  | null
  | undefined;

type EvoluServerUrlInput = Stringifiable;

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
  instance: EvoluInstance,
  cb: (db: EvoluQueryBuilder) => EvoluSelectBuilder,
): unknown => {
  const fn = Reflect.get(Object(instance), "createQuery");
  if (typeof fn !== "function") return null;
  return fn.call(instance, cb);
};

const loadUntypedQueryRows = async (
  instance: EvoluInstance,
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

export const normalizeEvoluServerUrl = (
  value: EvoluServerUrlInput,
): string | null => {
  const raw = String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    // Preserve pathname (some servers may be hosted under a path), but drop
    // search/hash for stable identity.
    return `${u.origin}${pathname === "/" ? "" : pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const normalizeUrlList = (
  urls: ReadonlyArray<EvoluServerUrlInput>,
): ReadonlyArray<string> => {
  const combined = urls
    .map(normalizeEvoluServerUrl)
    .filter((v): v is string => Boolean(v));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const url of combined) {
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(url);
  }

  return unique;
};

const getEvoluDisabledServerUrls = (): ReadonlyArray<string> => {
  const stored = safeLocalStorageGetJson(
    EVOLU_SERVERS_DISABLED_STORAGE_KEY,
    EffectSchema.Array(EffectSchema.String),
    [],
  );
  return normalizeUrlList(stored);
};

export const setEvoluServerDisabled = (
  url: string,
  disabled: boolean,
): void => {
  const normalized = normalizeEvoluServerUrl(url);
  if (!normalized) return;
  const current = [...getEvoluDisabledServerUrls()];
  const lower = normalized.toLowerCase();
  const next = disabled
    ? normalizeUrlList([...current, normalized])
    : normalizeUrlList(current.filter((u) => u.toLowerCase() !== lower));
  safeLocalStorageSetJson(EVOLU_SERVERS_DISABLED_STORAGE_KEY, next);
};

const getEvoluConfiguredServerUrls = (): ReadonlyArray<string> => {
  const stored = safeLocalStorageGetJson(
    EVOLU_SERVERS_STORAGE_KEY,
    EffectSchema.Array(EffectSchema.String),
    [],
  );

  const defaultRemoved = safeLocalStorageGetJson(
    EVOLU_SERVERS_DEFAULT_REMOVED_STORAGE_KEY,
    EffectSchema.Boolean,
    false,
  );

  const combined = [
    ...(defaultRemoved ? [] : DEFAULT_EVOLU_SERVER_URLS),
    ...stored,
  ];

  const unique = normalizeUrlList(combined);

  // If everything is removed, return empty list (= local-only instance).
  return unique;
};

const getEvoluActiveServerUrls = (): ReadonlyArray<string> => {
  const configured = getEvoluConfiguredServerUrls();
  const disabled = getEvoluDisabledServerUrls();
  const disabledLower = new Set(disabled.map((u) => u.toLowerCase()));
  return configured.filter((u) => !disabledLower.has(u.toLowerCase()));
};

const setEvoluServerUrls = (urls: ReadonlyArray<string>): void => {
  const normalized = urls
    .map(normalizeEvoluServerUrl)
    .filter((v): v is string => Boolean(v));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const url of normalized) {
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(url);
  }

  // Persist whether defaults are removed, and persist only non-default extras.
  const defaultsLower = new Set(
    DEFAULT_EVOLU_SERVER_URLS.map((u) => u.toLowerCase()),
  );
  const hasAnyDefault = unique.some((u) => defaultsLower.has(u.toLowerCase()));
  safeLocalStorageSetJson(
    EVOLU_SERVERS_DEFAULT_REMOVED_STORAGE_KEY,
    !hasAnyDefault,
  );

  const extras = unique.filter((u) => !defaultsLower.has(u.toLowerCase()));
  safeLocalStorageSetJson(EVOLU_SERVERS_STORAGE_KEY, extras);
};

const EVOLU_SERVER_URLS: ReadonlyArray<string> = getEvoluActiveServerUrls();

const buildEvoluTransports = (
  urls: ReadonlyArray<string>,
): ReadonlyArray<{ type: "WebSocket"; url: string }> =>
  urls.map((url) => ({ type: "WebSocket", url }));

const EVOLU_TRANSPORTS: ReadonlyArray<{
  type: "WebSocket";
  url: string;
}> = buildEvoluTransports(EVOLU_SERVER_URLS);

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

const CashuTokenId = Evolu.id("CashuToken");
export type CashuTokenId = typeof CashuTokenId.Type;

const NostrIdentityId = Evolu.id("NostrIdentity");
type NostrIdentityId = typeof NostrIdentityId.Type;

const NostrMessageId = Evolu.id("NostrMessage");
type NostrMessageId = typeof NostrMessageId.Type;

const NostrReactionId = Evolu.id("NostrReaction");
type NostrReactionId = typeof NostrReactionId.Type;

const OwnerMetaId = Evolu.id("OwnerMeta");
type OwnerMetaId = typeof OwnerMetaId.Type;

export const Schema = {
  contact: {
    id: ContactId,
    name: Evolu.nullOr(Evolu.NonEmptyString1000),
    // "1" once the user typed a custom name; profile updates then leave `name` alone.
    nameSetByUser: Evolu.nullOr(Evolu.SqliteBoolean),
    npub: Evolu.nullOr(Evolu.NonEmptyString1000),
    lnAddress: Evolu.nullOr(Evolu.NonEmptyString1000),
    // "1" once the user typed a custom lightning address; profile updates
    // then leave `lnAddress` alone until the override is cleared.
    lnAddressSetByUser: Evolu.nullOr(Evolu.SqliteBoolean),
    groupName: Evolu.nullOr(Evolu.NonEmptyString1000),
    groupNamesJson: Evolu.nullOr(Evolu.NonEmptyString1000),
    archivedAtSec: Evolu.nullOr(Evolu.PositiveInt),
    // Read cursor: created_at (seconds) of the newest chat message the user
    // has seen in this conversation.
    chatLastSeenAtSec: Evolu.nullOr(Evolu.PositiveInt),
    // Peer's reported seen window (createdAtSec bounds from their latest
    // read receipt): our outgoing messages in (since, upTo] render as seen.
    chatPeerSeenSinceSec: Evolu.nullOr(Evolu.PositiveInt),
    chatPeerSeenAtSec: Evolu.nullOr(Evolu.PositiveInt),
  },
  nostrIdentity: {
    id: NostrIdentityId,
    // Bech32 NIP-19 secret key, must start with "nsec".
    nsec: Evolu.NonEmptyString1000,
    npub: Evolu.nullOr(Evolu.NonEmptyString1000),
    source: Evolu.nullOr(Evolu.NonEmptyString100),
    switchedAtSec: Evolu.nullOr(Evolu.PositiveInt),
  },
  nostrMessage: {
    id: NostrMessageId,
    contactId: ContactId,
    // "in" | "out"
    direction: Evolu.NonEmptyString100,
    // Decrypted plaintext message.
    content: Evolu.NonEmptyString,
    // Gift-wrapped event id (kind 1059) used for de-duplication.
    wrapId: Evolu.NonEmptyString1000,
    // Inner (rumor) event id (kind 14, unsigned) if available.
    rumorId: Evolu.nullOr(Evolu.NonEmptyString1000),
    // Sender pubkey hex (64 chars) of the inner message.
    // Can be null for local-only queued placeholders.
    pubkey: Evolu.nullOr(Evolu.NonEmptyString1000),
    // created_at (seconds) from the inner event when available.
    createdAtSec: Evolu.PositiveInt,
    // Client-generated id for optimistic send/ack matching.
    clientId: Evolu.nullOr(Evolu.NonEmptyString1000),
    // "sent" | "pending"
    status: Evolu.nullOr(Evolu.NonEmptyString100),
    // "1" for local-only placeholders.
    localOnly: Evolu.nullOr(Evolu.NonEmptyString100),
    // Reply metadata (NIP-10).
    replyToId: Evolu.nullOr(Evolu.NonEmptyString1000),
    replyToContent: Evolu.nullOr(Evolu.NonEmptyString),
    rootMessageId: Evolu.nullOr(Evolu.NonEmptyString1000),
    // Edit metadata.
    editedAtSec: Evolu.nullOr(Evolu.PositiveInt),
    editedFromId: Evolu.nullOr(Evolu.NonEmptyString1000),
    // "1" if the message content was edited.
    isEdited: Evolu.nullOr(Evolu.NonEmptyString100),
    // First known message content before edits.
    originalContent: Evolu.nullOr(Evolu.NonEmptyString),
  },
  nostrReaction: {
    id: NostrReactionId,
    // Target message rumor id.
    messageId: Evolu.NonEmptyString1000,
    reactorPubkey: Evolu.NonEmptyString1000,
    emoji: Evolu.NonEmptyString100,
    createdAtSec: Evolu.PositiveInt,
    // Gift-wrapped event id carrying the reaction or delete.
    wrapId: Evolu.NonEmptyString1000,
    // Client-generated id for optimistic send/ack matching.
    clientId: Evolu.nullOr(Evolu.NonEmptyString1000),
    // "sent" | "pending"
    status: Evolu.nullOr(Evolu.NonEmptyString100),
  },
  cashuToken: {
    id: CashuTokenId,
    // Most recent (accepted) token.
    token: Evolu.NonEmptyString,
    // Token text the row was first created from — the row's stable identity
    // for dedup. Reads fall back to rawToken/token for legacy rows.
    originalTokenText: Evolu.nullOr(Evolu.NonEmptyString),
    // Deprecated compatibility column. New rows use a deterministic id derived
    // from the original token and only store the latest spendable token here.
    rawToken: Evolu.nullOr(Evolu.NonEmptyString),
    // Deprecated compatibility columns. New writes derive this metadata from
    // token; keep the columns while older clients/data still use them.
    mint: Evolu.nullOr(Evolu.NonEmptyString1000),
    unit: Evolu.nullOr(Evolu.NonEmptyString100),
    amount: Evolu.nullOr(Evolu.PositiveInt),
    // "pending" | "accepted" | "error"
    state: Evolu.nullOr(Evolu.NonEmptyString100),
    error: Evolu.nullOr(Evolu.NonEmptyString1000),
  },

  transaction: {
    id: TransactionId,
    // Event time is intentionally stored separately from Evolu's updatedAt:
    // later row updates must not change when the payment actually happened.
    createdAtSec: Evolu.PositiveInt,
    direction: Evolu.NonEmptyString100,
    status: Evolu.NonEmptyString100,
    amount: Evolu.nullOr(Evolu.PositiveInt),
    fee: Evolu.nullOr(Evolu.PositiveInt),
    // Deprecated compatibility column. New writes derive category from method.
    category: Evolu.nullOr(Evolu.NonEmptyString100),
    method: Evolu.nullOr(Evolu.NonEmptyString100),
    // Deprecated compatibility columns. New writes use method + status and
    // derive labels/icons in the transaction view.
    phase: Evolu.nullOr(Evolu.NonEmptyString100),
    note: Evolu.nullOr(Evolu.NonEmptyString1000),
    detailsJson: Evolu.nullOr(Evolu.NonEmptyString),
    iconKind: Evolu.nullOr(Evolu.NonEmptyString100),
    contactId: Evolu.nullOr(ContactId),
    mint: Evolu.nullOr(Evolu.NonEmptyString1000),
    unit: Evolu.nullOr(Evolu.NonEmptyString100),
    error: Evolu.nullOr(Evolu.NonEmptyString1000),
    pendingLabel: Evolu.nullOr(Evolu.NonEmptyString100),
  },

  ownerMeta: {
    id: OwnerMetaId,
    scope: Evolu.NonEmptyString100,
    value: Evolu.NonEmptyString1000,
  },
};

const createEvoluForUser = (mnemonic: string | null) => {
  const dbName = mnemonic ? generateDbNameFromMnemonic(mnemonic) : "linky-anon";

  const validatedName = SimpleName.from(dbName);
  const finalName = validatedName.ok
    ? validatedName.value
    : SimpleName.orThrow("linky-default");

  const externalAppOwner = (() => {
    if (!mnemonic) return null;
    const mnemonicResult = Evolu.Mnemonic.fromUnknown(mnemonic);
    if (!mnemonicResult.ok) return null;
    const ownerSecret = Evolu.mnemonicToOwnerSecret(mnemonicResult.value);
    return Evolu.createAppOwner(ownerSecret);
  })();

  return createEvolu(evoluReactWebDeps)(Schema, {
    name: finalName,
    transports: EVOLU_TRANSPORTS,
    enableLogging: isEvoluLoggingEnabled(),
    inMemory: shouldUseInMemoryEvoluStorage(),
    ...(externalAppOwner ? { externalAppOwner } : {}),
  });
};

type EvoluInstance = ReturnType<typeof createEvoluForUser>;

let globalEvoluInstance: EvoluInstance | null = null;

const getEvolu = (mnemonic?: string | null): EvoluInstance => {
  if (mnemonic !== undefined) {
    globalEvoluInstance = createEvoluForUser(mnemonic);
  }

  if (!globalEvoluInstance) {
    globalEvoluInstance = createEvoluForUser(
      safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY),
    );
  }

  return globalEvoluInstance;
};

export const evolu = getEvolu();

export const createCashuTokensAllQuery = () =>
  evolu.createQuery((db) =>
    db.selectFrom("cashuToken").selectAll().orderBy("createdAt", "desc"),
  );

export const createContactsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("contact").selectAll());
export const createNostrMessagesAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("nostrMessage").selectAll());
export const createNostrReactionsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("nostrReaction").selectAll());
export const createTransactionsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("transaction").selectAll());
export type ContactRow = Evolu.InferRow<
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

export const useEvoluSyncOwner = (enabled: boolean): Evolu.SyncOwner | null => {
  const [syncOwner, setSyncOwner] = useState<Evolu.SyncOwner | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void getEvolu()
      .appOwner.then((owner) => {
        if (cancelled) return;
        setSyncOwner(owner);
      })
      .catch(() => {
        if (cancelled) return;
        setSyncOwner(null);
      });

    return () => {
      cancelled = true;
      setSyncOwner(null);
    };
  }, [enabled]);

  return enabled ? syncOwner : null;
};

export const useEvoluLastError = (opts?: {
  logToConsole?: boolean;
}): Evolu.EvoluError | null => {
  const logToConsole = opts?.logToConsole ?? false;
  const [lastError, setLastError] = useState<Evolu.EvoluError | null>(() =>
    getEvolu().getError(),
  );

  useEffect(() => {
    const instance = getEvolu();
    const unsub = instance.subscribeError(() => {
      const err = instance.getError();
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
  }, [logToConsole]);

  return lastError;
};

const getEvoluDatabaseInfo = async (
  isCurrent: () => boolean,
): Promise<{
  bytes: number;
  tableCounts: Record<string, number | null>;
  historyCount: number | null;
}> => {
  const tables = [
    "contact",
    "cashuToken",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
    "ownerMeta",
  ] as const;

  const instance = getEvolu();

  const dbBytesPromise = (async () => {
    try {
      const root = await navigator.storage?.getDirectory?.();
      if (!root) return 0;

      const mnemonic = safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY);

      const expectedDir = mnemonic
        ? `.${generateDbNameFromMnemonic(mnemonic)}`
        : ".linky-anon";

      let totalSize = 0;
      const allDirs: string[] = [];
      // @ts-expect-error OPFS FileSystemDirectoryHandle.entries() not yet in all TS libs
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === "directory") allDirs.push(name);
        if (name === expectedDir && handle.kind === "directory") {
          for await (const [sub, subH] of handle.entries()) {
            if (sub === ".opaque" && subH.kind === "directory") {
              let maxSize = 0;
              for await (const [, fileH] of subH.entries()) {
                if (fileH.kind === "file") {
                  const f = await fileH.getFile();
                  if (f.size > maxSize) maxSize = f.size;
                }
              }
              totalSize = maxSize; // Take only the largest file (main SQLite)
            }
          }
          break;
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  })();

  const tableCountsPromise = (async () => {
    const out: Record<string, number | null> = {};
    for (const table of tables) {
      if (!isCurrent()) break;
      try {
        const q = createUntypedQuery(instance, (db) =>
          db.selectFrom(table).select((eb) => eb.fn.countAll().as("count")),
        );
        const rows = await loadUntypedQueryRows(instance, q);
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
      const q = createUntypedQuery(instance, (db) =>
        db
          .selectFrom("evolu_history")
          .select((eb) => eb.fn.countAll().as("count")),
      );
      const rows = await loadUntypedQueryRows(instance, q);
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

interface EvoluHistoryMutationCountRequest {
  key: string;
  ownerId: string;
  rotatedAtMs: number;
  tables: readonly string[];
}

const timestampAfterMs = (timestampMs: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  let value = Math.max(0, Math.trunc(timestampMs) + 1);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = value % 256;
    value = Math.floor(value / 256);
  }
  return bytes;
};

export const loadEvoluHistoryMutationCounts = async (
  requests: readonly EvoluHistoryMutationCountRequest[],
): Promise<Readonly<Record<string, number>>> => {
  const instance = getEvolu();
  const counts: Record<string, number> = {};

  await Promise.all(
    requests.map(async (request) => {
      const ownerId = decodeBase64Url(request.ownerId);
      const tables = request.tables
        .map((table) => table.trim())
        .filter(Boolean);
      if (!ownerId?.length || tables.length === 0) {
        counts[request.key] = 0;
        return;
      }

      try {
        const q = createUntypedQuery(instance, (db) =>
          db
            .selectFrom("evolu_history")
            .select((eb) => eb.fn.count("timestamp").distinct().as("count"))
            .where("ownerId", "=", ownerId)
            .where("table", "in", tables)
            .where("timestamp", ">=", timestampAfterMs(request.rotatedAtMs))
            .groupBy(["table", "id"]),
        );
        const rows = await loadUntypedQueryRows(instance, q);
        counts[request.key] = rows.reduce(
          (total, row) => total + Number(row.count ?? 0),
          0,
        );
      } catch {
        counts[request.key] = 0;
      }
    }),
  );

  return counts;
};

export const subscribeEvoluHistoryMutationVersion = (
  listener: () => void,
): (() => void) => {
  const instance = getEvolu();
  const q = createUntypedQuery(instance, (db) =>
    db.selectFrom("evolu_history").select((eb) => eb.fn.countAll().as("count")),
  );
  const subscribeQuery = Reflect.get(Object(instance), "subscribeQuery");
  if (typeof subscribeQuery !== "function") return () => {};
  const subscribe = Reflect.apply(subscribeQuery, instance, [q]);
  if (typeof subscribe !== "function") return () => {};
  const unsubscribe = Reflect.apply(subscribe, undefined, [listener]);
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
};

export const loadEvoluHistoryData = async (
  limit = 100,
  offset = 0,
): Promise<EvoluHistoryRow[]> => {
  const instance = getEvolu();
  try {
    const q = createUntypedQuery(instance, (db) =>
      db
        .selectFrom("evolu_history")
        .selectAll()
        .orderBy("timestamp", "desc")
        .limit(limit)
        .offset(offset),
    );
    const rows = await loadUntypedQueryRows(instance, q);
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

export const loadEvoluCurrentData = async (): Promise<
  Record<string, Record<string, JsonValue>[]>
> => {
  const tables = [
    "contact",
    "cashuToken",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
    "ownerMeta",
  ] as const;

  const instance = getEvolu();
  const result: Record<string, Record<string, JsonValue>[]> = {};

  for (const table of tables) {
    try {
      const q = createUntypedQuery(instance, (db) =>
        db.selectFrom(table).selectAll().limit(100),
      );
      const rows = await loadUntypedQueryRows(instance, q);
      result[table] = toJsonRows(rows);
    } catch {
      result[table] = [];
    }
  }

  return result;
};

export const wipeEvoluStorage = (): void => {
  const storedMnemonic = safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY);

  const mnemonicResult = Evolu.Mnemonic.fromUnknown(storedMnemonic);
  if (!mnemonicResult.ok) {
    throw new Error("Missing stored mnemonic");
  }

  // Hard wipe Evolu local storage (journal + state) and reload.
  void getEvolu().restoreAppOwner(mnemonicResult.value, { reload: true });
};

export const useEvoluDatabaseInfoState = (opts?: {
  enabled?: boolean;
  onError?: (err: unknown) => void;
}) => {
  const enabled = opts?.enabled ?? true;
  const onError = opts?.onError;

  const [info, setInfo] = useState<EvoluDatabaseInfo>(() => ({
    bytes: null,
    tableCounts: {},
    historyCount: null,
    updatedAtMs: null,
  }));
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
  }, [enabled, onError]);

  useEffect(() => {
    if (!enabled) return;
    if (queryFailed.current) return;
    const cancelRefresh = () => {
      refreshGeneration.current += 1;
      refreshing.current = false;
      refreshRequested.current = false;
      setIsBusy(false);
    };
    const instance = getEvolu();
    let unsubscribe = () => {};
    const unsubscribeError = instance.subscribeError(() => {
      const error = instance.getError();
      if (error?.type !== "SqliteError") return;
      // Evolu leaves a failed loadQuery promise cached and unresolved until reload.
      queryFailed.current = true;
      unsubscribe();
      cancelRefresh();
      setInfo({
        bytes: null,
        tableCounts: {},
        historyCount: null,
        updatedAtMs: null,
      });
      onError?.(error);
    });
    unsubscribe = subscribeEvoluHistoryMutationVersion(() => {
      void refresh();
    });
    void refresh();
    return () => {
      unsubscribe();
      unsubscribeError();
      cancelRefresh();
    };
  }, [enabled, onError, refresh]);

  return {
    info,
    isBusy,
    refresh,
  } as const;
};

export const useEvoluServersManager = (opts?: {
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}) => {
  const probeIntervalMs = opts?.probeIntervalMs ?? 15000;
  const probeTimeoutMs = opts?.probeTimeoutMs ?? 3500;
  const canRunNetworkWork = useDeferredOnlineReady();

  const [configuredUrls, setConfiguredUrlsState] = useState<string[]>(() => [
    ...getEvoluConfiguredServerUrls(),
  ]);
  const [disabledUrls, setDisabledUrlsState] = useState<string[]>(() => [
    ...getEvoluDisabledServerUrls(),
  ]);
  const [statusByUrl, setStatusByUrl] = useState<
    Record<string, EvoluServerStatus>
  >(() => ({}));
  const [reloadRequired, setReloadRequired] = useState(false);

  const disabledLower = useMemo(() => {
    const s = new Set<string>();
    for (const u of disabledUrls) s.add(u.toLowerCase());
    return s;
  }, [disabledUrls]);

  const isOffline = useCallback(
    (url: string): boolean => disabledLower.has(url.toLowerCase()),
    [disabledLower],
  );

  const activeUrls = useMemo(
    () => configuredUrls.filter((u) => !isOffline(u)),
    [configuredUrls, isOffline],
  );

  const refreshFromStorage = useCallback(() => {
    setConfiguredUrlsState([...getEvoluConfiguredServerUrls()]);
    setDisabledUrlsState([...getEvoluDisabledServerUrls()]);
  }, []);

  const setServerUrls = useCallback(
    (nextUrls: string[]) => {
      setEvoluServerUrls(nextUrls);
      refreshFromStorage();
      setReloadRequired(true);
    },
    [refreshFromStorage],
  );

  const setServerOffline = useCallback(
    (url: string, offline: boolean) => {
      setEvoluServerDisabled(url, offline);
      refreshFromStorage();
      setReloadRequired(true);
    },
    [refreshFromStorage],
  );

  useEffect(() => {
    if (activeUrls.length === 0) return;
    if (!canRunNetworkWork) return;

    let cancelled = false;

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
  }, [activeUrls, canRunNetworkWork, probeIntervalMs, probeTimeoutMs]);

  const effectiveStatusByUrl = useMemo(() => {
    if (canRunNetworkWork) return statusByUrl;

    const next = { ...statusByUrl };
    for (const url of activeUrls) {
      next[url] = "disconnected";
    }
    return next;
  }, [activeUrls, canRunNetworkWork, statusByUrl]);

  return {
    configuredUrls,
    disabledUrls,
    activeUrls,
    statusByUrl: effectiveStatusByUrl,
    reloadRequired,
    refreshFromStorage,
    setServerUrls,
    isOffline,
    setServerOffline,
  } as const;
};

export { EvoluProvider };

export const useEvolu = createUseEvolu(getEvolu());
