import { ContactId } from "./evoluIds";
export { ContactId, TransactionId } from "./evoluIds";
import { Schema as EffectSchema } from "effect";
import * as Evolu from "@evolu/common";
import { createEvolu, SimpleName } from "@evolu/common";
import {
  appOwnerFromMnemonic,
  linkyScopes,
  messageScopes,
  LinkySchema,
  type CashuOperationId,
  type CashuProofId,
  type LinkyScope,
  type LinkyStore,
  type NostrIdentityId,
  type PointerRepair,
  type ShardRotation,
} from "@linky-fit/linksync";
import {
  createEvoluShardDb,
  trackOwnerSync,
  type EvoluRelayStatus,
  type UnconfirmedWrite,
} from "@linky-fit/linksync/evolu";
import { createSharedWebWorker, evoluWebDeps } from "@evolu/web";
import { flushSync } from "react-dom";
import { Effect } from "effect";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useDeferredOnlineReady } from "./hooks/useDeferredOnlineReady";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "./mnemonic";
import {
  createAccountStore,
  markAwaitingFirstHydration,
} from "./firstHydration";
import { shouldUseInMemoryEvoluStorage } from "./platform/evoluWebStorage";
import type { JsonValue } from "./types/json";
import { base64 } from "@scure/base";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "./utils/storage";
import { isRecord } from "./utils/unknown";
import { getInspectorEmissionEnabled } from "./devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "./devtools/inspector/reportInspectorRows";
import { reportAppLog } from "./devtools/inspector/appLog";
import { loadRecommendedRelays } from "./utils/recommendedRelays";

const isEvoluLoggingEnabled = (): boolean => {
  if (!import.meta.env.DEV) return false;

  // Enable only when explicitly requested, because SQL logging is very noisy.
  // Toggle in devtools: localStorage.setItem('linky_debug_evolu_sql', '1')
  return safeLocalStorageGet("linky_debug_evolu_sql") === "1";
};

// Servers the user added; the recommended servers are always configured on top.
const EVOLU_USER_SERVERS_STORAGE_KEY = "linky.evoluServers.user.v1";

// Pre-recommendation storage, read once to migrate it into the user servers.
const LEGACY_EVOLU_SERVERS_STORAGE_KEY = "linky.evoluServers.v1";
const LEGACY_EVOLU_SERVERS_DEFAULT_REMOVED_STORAGE_KEY =
  "linky.evoluServers.defaultRemoved.v1";
const LEGACY_DEFAULT_EVOLU_SERVER_URLS = [
  "wss://evolu.linky.fit",
  "wss://free.evoluhq.com",
];

const EVOLU_SERVERS_DISABLED_STORAGE_KEY = "linky.evoluServers.disabled.v1";

export type EvoluServerStatus = "checking" | "connected" | "disconnected";
export type EvoluErrorType = Evolu.EvoluError["type"];

interface EvoluDatabaseInfo {
  bytes: number | null;
  tableCounts: Record<string, number | null>;
  historyCount: number | null;
  updatedAtMs: number | null;
}

const envEvoluServerUrls = (import.meta.env.VITE_EVOLU_SERVER_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));

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

// Read once per launch: a refreshed recommendation applies on the next start,
// when the transports are created again.
const RECOMMENDED_EVOLU_SERVER_URLS = normalizeUrlList(
  envEvoluServerUrls.length > 0
    ? envEvoluServerUrls
    : loadRecommendedRelays().evolu,
);

const isRecommendedEvoluServer = (url: string): boolean =>
  RECOMMENDED_EVOLU_SERVER_URLS.some(
    (recommended) => recommended.toLowerCase() === url.toLowerCase(),
  );

const getEvoluConfiguredServerUrls = (): ReadonlyArray<string> =>
  normalizeUrlList([
    ...RECOMMENDED_EVOLU_SERVER_URLS,
    ...safeLocalStorageGetJson(
      EVOLU_USER_SERVERS_STORAGE_KEY,
      EffectSchema.Array(EffectSchema.String),
      [],
    ),
  ]);

const getEvoluActiveServerUrls = (): ReadonlyArray<string> => {
  const configured = getEvoluConfiguredServerUrls();
  const disabled = getEvoluDisabledServerUrls();
  const disabledLower = new Set(disabled.map((u) => u.toLowerCase()));
  return configured.filter((u) => !disabledLower.has(u.toLowerCase()));
};

const setEvoluServerUrls = (urls: ReadonlyArray<string>): void => {
  safeLocalStorageSetJson(
    EVOLU_USER_SERVERS_STORAGE_KEY,
    normalizeUrlList(urls).filter((url) => !isRecommendedEvoluServer(url)),
  );
};

// Older versions stored the full selection, or nothing while the built-in
// defaults were untouched; servers that are not recommended now stay as the
// user's. A fresh install has neither a selection nor a seed.
const migrateLegacyEvoluServers = (): void => {
  if (safeLocalStorageGet(EVOLU_USER_SERVERS_STORAGE_KEY) !== null) return;
  const stored = safeLocalStorageGetJson(
    LEGACY_EVOLU_SERVERS_STORAGE_KEY,
    EffectSchema.Array(EffectSchema.String),
    [],
  );
  const defaultsRemoved = safeLocalStorageGetJson(
    LEGACY_EVOLU_SERVERS_DEFAULT_REMOVED_STORAGE_KEY,
    EffectSchema.Boolean,
    false,
  );
  const isExistingInstall =
    safeLocalStorageGet(LEGACY_EVOLU_SERVERS_STORAGE_KEY) !== null ||
    safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY) !== null;
  const legacyDefaults =
    envEvoluServerUrls.length > 0
      ? envEvoluServerUrls
      : LEGACY_DEFAULT_EVOLU_SERVER_URLS;
  setEvoluServerUrls(
    isExistingInstall && !defaultsRemoved
      ? [...legacyDefaults, ...stored]
      : stored,
  );
  reportAppLog({
    tag: "evolu.userServersMigrated",
    summary: "Kept the configured Evolu servers that are not recommended",
    payload: { legacyServerUrls: stored, defaultsRemoved, isExistingInstall },
  });
};

migrateLegacyEvoluServers();

/** The Evolu relays this page load syncs with; a changed list applies after a reload. */
export const EVOLU_SERVER_URLS: ReadonlyArray<string> =
  getEvoluActiveServerUrls();

const buildEvoluTransports = (
  urls: ReadonlyArray<string>,
): ReadonlyArray<{ type: "WebSocket"; url: string }> =>
  urls.map((url) => ({ type: "WebSocket", url }));

const EVOLU_TRANSPORTS: ReadonlyArray<{
  type: "WebSocket";
  url: string;
}> = buildEvoluTransports(EVOLU_SERVER_URLS);

const CashuTokenId = Evolu.id("CashuToken");
export type CashuTokenId = typeof CashuTokenId.Type;
export type { CashuOperationId, CashuProofId, NostrIdentityId };

const NostrMessageId = Evolu.id("NostrMessage");
type NostrMessageId = typeof NostrMessageId.Type;

const NostrReactionId = Evolu.id("NostrReaction");
type NostrReactionId = typeof NostrReactionId.Type;

const OwnerMetaId = Evolu.id("OwnerMeta");
type OwnerMetaId = typeof OwnerMetaId.Type;

/**
 * The app schema is a superset of the package's `LinkySchema`: the package
 * tables plus the legacy lane tables (`nostrMessage`, `nostrReaction`,
 * `cashuToken`, `ownerMeta`) and the legacy columns older versions wrote
 * (read cursors on `contact`, `category` and `phase` on `transaction`), all of
 * which only the lane migration reads. The package's branded ids are the
 * source of truth; only the legacy tables keep ids of their own.
 * Legacy schema removal gate in app/migrations/AGENTS.md.
 */
export const Schema = {
  ...LinkySchema,
  contact: {
    ...LinkySchema.contact,
    // Read cursor: created_at (seconds) of the newest chat message the user
    // has seen in this conversation.
    chatLastSeenAtSec: Evolu.nullOr(Evolu.PositiveInt),
    // Peer's reported seen window (createdAtSec bounds from their latest
    // read receipt): our outgoing messages in (since, upTo] render as seen.
    chatPeerSeenSinceSec: Evolu.nullOr(Evolu.PositiveInt),
    chatPeerSeenAtSec: Evolu.nullOr(Evolu.PositiveInt),
  },
  nostrMessage: {
    id: NostrMessageId,
    contactId: ContactId,
    // "in" | "out"
    direction: Evolu.NonEmptyString100,
    // Decrypted plaintext message.
    content: Evolu.NonEmptyString,
    // Incoming rows use the rumor id here as their de-duplication key.
    wrapId: Evolu.NonEmptyString1000,
    // Edits keep the original message's rumor id so reactions and replies resolve.
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
    ...LinkySchema.transaction,
    // Deprecated compatibility column. New writes derive category from method.
    category: Evolu.nullOr(Evolu.NonEmptyString100),
    // Deprecated compatibility columns. New writes use method + status and
    // derive labels/icons in the transaction view.
    phase: Evolu.nullOr(Evolu.NonEmptyString100),
  },
  ownerMeta: {
    id: OwnerMetaId,
    scope: Evolu.NonEmptyString100,
    value: Evolu.NonEmptyString1000,
  },
};

const evoluWorker = trackOwnerSync((name) =>
  createSharedWebWorker(
    name,
    () =>
      new Worker(new URL("./evoluDb.worker.ts", import.meta.url), {
        type: "module",
      }),
  ),
);

/** Which owners finished a sync round with an Evolu relay; the shard store's hydration rests on it. */
export const ownerSync = evoluWorker.ownerSync;

/** Each Evolu relay socket's live status, keyed by relay url. */
export const useEvoluRelayStatuses = (): Readonly<
  Record<string, EvoluRelayStatus>
> =>
  useSyncExternalStore(
    ownerSync.subscribeRelayStatuses,
    ownerSync.relayStatuses,
  );

const serverStatusOf = (
  status: EvoluRelayStatus | undefined,
): EvoluServerStatus => {
  if (status === undefined || status === "connecting") return "checking";
  return status === "unreachable" ? "disconnected" : "connected";
};

ownerSync.subscribeFailures(({ ownerId, error, endsRound }) => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "OwnerSyncFailed",
      summary: endsRound
        ? `An Evolu relay answered with ${error}; the owner's sync round ended there`
        : `An Evolu relay answered with ${error} before any error-free answer; the owner stays unsynced`,
      links: { owner: ownerId },
      payload: { ownerId, error, endsRound },
    },
  ]);
});

const evoluDeps: Evolu.EvoluDeps = {
  ...evoluWebDeps,
  flushSync,
  createDbWorker: evoluWorker.createDbWorker,
};

const createEvoluForUser = (mnemonic: string | null) => {
  const dbName = mnemonic ? generateDbNameFromMnemonic(mnemonic) : "linky-anon";

  const validatedName = SimpleName.from(dbName);
  const finalName = validatedName.ok
    ? validatedName.value
    : SimpleName.orThrow("linky-default");

  const externalAppOwner = mnemonic ? appOwnerFromMnemonic(mnemonic) : null;

  return createEvolu(evoluDeps)(Schema, {
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

let linkyStorePromise: Promise<LinkyStore> | null = null;

const reportShardRotated = (
  store: LinkyStore,
  rotation: ShardRotation<LinkyScope>,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "ShardRotated",
      summary: `${rotation.scope} shard pointer moved to index ${rotation.index}`,
      links: { owner: store.shardOwner(rotation.scope, rotation.index).id },
      payload: rotation,
    },
  ]);
};

const reportShardsSubscribed = async (
  store: LinkyStore,
  reason: "boot" | "rotation" | "forget",
): Promise<void> => {
  if (!getInspectorEmissionEnabled()) return;
  const owners = (await Effect.runPromise(store.syncOwners())).map(
    (owner) => owner.id,
  );
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "ShardsSubscribed",
      summary: `Syncing the app owner and ${owners.length - 1} shards`,
      links: { owner: owners },
      payload: { reason, owners: owners.length },
    },
  ]);
};

const reportAccountHydrated = async (store: LinkyStore): Promise<void> => {
  if (!getInspectorEmissionEnabled()) return;
  const owners = (await Effect.runPromise(store.syncOwners())).map(
    (owner) => owner.id,
  );
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "AccountHydrated",
      summary: `Account data arrived for the app owner and ${owners.length - 1} shards`,
      links: { owner: owners },
      payload: {
        owners: owners.length,
        sincePageLoadMs: performance.now(),
      },
    },
  ]);
};

const reportWriteUnconfirmed = (write: UnconfirmedWrite): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "WriteUnconfirmed",
      summary: `Evolu did not confirm a ${write.table} write within 10 s; it may have been dropped`,
      links: { owner: write.ownerId, row: write.id },
      payload: write,
    },
  ]);
};

const reportShardPointersRepaired = (
  store: LinkyStore,
  repairs: ReadonlyArray<PointerRepair<LinkyScope>>,
): void => {
  if (!getInspectorEmissionEnabled() || repairs.length === 0) return;
  reportInspectorRows(
    repairs.map((repair) => ({
      at: Date.now(),
      channel: "evolu.sync",
      tag: "ShardPointerRepaired",
      summary: `${repair.scope} shard pointer moved back up from index ${repair.from} to ${repair.to}`,
      links: { owner: store.shardOwner(repair.scope, repair.to).id },
      payload: repair,
    })),
  );
};

/** Runs in the background: it waits for hydration and for the relay. */
const repairShardPointers = (store: LinkyStore): void => {
  void Effect.runPromise(store.repairPointers()).then(
    (repairs) => reportShardPointersRepaired(store, repairs),
    (error: unknown) =>
      reportAppLog({
        tag: "evolu.shardPointerRepairFailed",
        summary: "Moving reset shard pointers back up failed",
        payload: { error: String(error) },
      }),
  );
};

const appScopes = {
  ...linkyScopes,
  messages: {
    ...linkyScopes.messages,
    rotation: linkyScopes.messages.rotation,
  },
};

export const setE2eMessagesRotation = (enabled: boolean): void => {
  if (import.meta.env.VITE_E2E !== "1") throw new Error("E2E build required");
  appScopes.messages.rotation = enabled
    ? { maxBytes: 256 * 1024, maxMutations: 8, cooldownMs: 0 }
    : linkyScopes.messages.rotation;
};

export const forgetChatShards = async () => {
  const store = await getLinkyStore();
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
    await reportShardsSubscribed(store, "forget");
  }
  return forgotten;
};

/** Resolves once the local database has answered a query. */
export const probeLocalDatabase = (): Promise<void> =>
  evolu
    .loadQuery(
      evolu.createQuery((db) =>
        db.selectFrom("ownerMeta").select("id").limit(1),
      ),
    )
    .then(() => undefined);

/**
 * The shard store over this Evolu instance. Resolves once the app owner is
 * known and the local database has answered a query; `appOwner` alone
 * resolves before the database worker is up. The store subscribes the app
 * owner and every visible shard for the page's lifetime and follows its
 * pointers, so a rotation here or on another device subscribes the new shard.
 */
export const getLinkyStore = (): Promise<LinkyStore> => {
  linkyStorePromise ??= Promise.all([
    evolu.appOwner,
    evolu.loadQuery(
      evolu.createQuery((db) =>
        db.selectFrom("shardPointer").select("id").limit(1),
      ),
    ),
  ]).then(async ([owner]) => {
    const key = (scope: string) =>
      `linky.shards.retainedFrom.${owner.id}.${scope}`;
    const store = createAccountStore(
      createEvoluShardDb(evolu, ownerSync, {
        onWriteUnconfirmed: reportWriteUnconfirmed,
      }),
      owner,
      {
        scopes: appScopes,
        hasEvoluRelay: EVOLU_TRANSPORTS.length > 0,
        retention: {
          get: (scope) =>
            safeLocalStorageGetJson(
              key(scope),
              EffectSchema.NullOr(
                EffectSchema.Number.pipe(
                  EffectSchema.int(),
                  EffectSchema.nonNegative(),
                ),
              ),
              null,
            ) ?? undefined,
          set: (scope, first) => safeLocalStorageSetJson(key(scope), first),
        },
      },
    );
    await Effect.runPromise(store.reconcileSync());
    void reportShardsSubscribed(store, "boot");
    store.followPointers((rotation) => {
      reportShardRotated(store, rotation);
      void reportShardsSubscribed(store, "rotation");
    });
    store.subscribeHydration(() => {
      void reportAccountHydrated(store);
    });
    repairShardPointers(store);
    return store;
  });
  return linkyStorePromise;
};

export const createOwnerMetaAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("ownerMeta").selectAll());
export const createNostrIdentitiesAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("nostrIdentity").selectAll());
export const createCashuTokensAllQuery = () =>
  evolu.createQuery((db) =>
    db.selectFrom("cashuToken").selectAll().orderBy("createdAt", "desc"),
  );

export const createCashuProofsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("cashuProof").selectAll());
export const createCashuOperationsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("cashuOperation").selectAll());

export const createContactsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("contact").selectAll());
export const createNostrMessagesAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("nostrMessage").selectAll());
export const createNostrReactionsAllQuery = () =>
  evolu.createQuery((db) => db.selectFrom("nostrReaction").selectAll());
export const createTransactionsAllQuery = () =>
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

  markAwaitingFirstHydration(mnemonicResult.value);
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

export const useEvoluServersManager = () => {
  const canRunNetworkWork = useDeferredOnlineReady();

  const [configuredUrls, setConfiguredUrlsState] = useState<string[]>(() => [
    ...getEvoluConfiguredServerUrls(),
  ]);
  const [disabledUrls, setDisabledUrlsState] = useState<string[]>(() => [
    ...getEvoluDisabledServerUrls(),
  ]);
  const relayStatuses = useEvoluRelayStatuses();
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
      if (getInspectorEmissionEnabled()) {
        reportAppLog({
          tag: "evolu.serversChanged",
          summary: "Updated Evolu servers; reload required",
          payload: {
            configuredUrls: getEvoluConfiguredServerUrls(),
            activeUrls: getEvoluActiveServerUrls(),
          },
        });
      }
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

  const statusByUrl = useMemo(
    (): Record<string, EvoluServerStatus> =>
      Object.fromEntries(
        activeUrls.map((url) => [
          url,
          canRunNetworkWork
            ? serverStatusOf(relayStatuses[url])
            : "disconnected",
        ]),
      ),
    [activeUrls, canRunNetworkWork, relayStatuses],
  );

  return {
    configuredUrls,
    disabledUrls,
    activeUrls,
    statusByUrl,
    reloadRequired,
    refreshFromStorage,
    setServerUrls,
    isOffline,
    isRecommended: isRecommendedEvoluServer,
    setServerOffline,
  } as const;
};
