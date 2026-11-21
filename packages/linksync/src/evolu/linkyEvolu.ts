import type {
  EvoluDeps,
  EvoluError,
  OwnerId,
  OwnerWebSocketTransport,
  ReadonlyStore,
  Run,
  SyncState,
} from "@evolu/common";
import type { ProtocolQuotaError } from "@evolu/common/local-first";
import {
  AppName,
  createAppOwner,
  createEvolu,
  createEvoluApp,
  createOwnerSecret,
  createQueryBuilder,
  Name,
  WebSocketUrlFromString,
} from "@evolu/common";
import { Effect, Schema } from "effect";
import {
  appOwnerFromMnemonic,
  type PointerRepair,
  type ShardRotation,
} from "../core";
import type { LinkyScope, LinkyScopes, LinkyStore } from "../model";
import { makeEvoluRelaySettings } from "./evoluRelaySettings";
import {
  createEvoluShardDb,
  type AppliedWrite,
  type EvoluRuntime,
  type FailedWrite,
  type LinkyEvolu,
} from "./evoluShardDb";
import { createAccountStore } from "./firstHydration";
import { readJson, writeJson, type KeyValueStorage } from "./keyValueStorage";
import { LinkyEvoluSchema, linkyIndexes } from "./linkyEvoluSchema";

export type { LinkyEvolu } from "./evoluShardDb";

/** The page's Evolu run, whose deps hold the shared `evoluError` and `syncState` stores. */
export type EvoluRun = Run<EvoluDeps>;

/** Thrown when a stored app mnemonic is present but cannot derive an Evolu owner. */
export class InvalidAppMnemonic extends Error {
  override readonly name = "InvalidAppMnemonic";

  constructor() {
    super("Stored account key is invalid; refusing to open another database");
  }
}

/** Thrown when Evolu refuses to open the database (held by another tab, newer version, etc.). */
export class EvoluDatabaseRefusedError extends Error {
  override readonly name = "EvoluDatabaseRefusedError";
  readonly evoluError: EvoluError;
  constructor(evoluError: EvoluError) {
    super(evoluError.type, { cause: evoluError });
    this.evoluError = evoluError;
  }
}

/** Thrown when persistent device storage is unavailable and `memoryOnly` was not requested. */
export class DeviceStorageUnavailableError extends Error {
  override readonly name = "DeviceStorageUnavailableError";
  constructor() {
    super("Device storage is unavailable");
  }
}

/** Coarse classification for UI recovery screens when opening a Linky database fails. */
export type EvoluOpenFailureReason =
  | "otherTab"
  | "storageUnavailable"
  | "other";

export const classifyEvoluOpenError = (
  error: unknown,
): EvoluOpenFailureReason => {
  if (
    error instanceof EvoluDatabaseRefusedError &&
    (error.evoluError.type === "DatabaseHeldError" ||
      error.evoluError.type === "OtherBuildRunningError")
  )
    return "otherTab";
  if (error instanceof DeviceStorageUnavailableError)
    return "storageUnavailable";
  return "other";
};

/** What the package reports for the inspector; the consumer turns each into a row. */
export type LinkyEvoluEvent =
  | {
      readonly _tag: "OwnerSyncFailed";
      readonly ownerId: OwnerId;
      /** Evolu's error type, such as `ProtocolQuotaError`. */
      readonly error: string;
    }
  | {
      readonly _tag: "ShardRotated";
      readonly rotation: ShardRotation<LinkyScope>;
      readonly owner: OwnerId;
    }
  | {
      readonly _tag: "ShardsSubscribed";
      readonly reason: "boot" | "rotation";
      /** The app owner first, then every subscribed shard owner. */
      readonly owners: ReadonlyArray<OwnerId>;
    }
  | {
      readonly _tag: "AccountHydrated";
      readonly owners: ReadonlyArray<OwnerId>;
    }
  | { readonly _tag: "OwnerDeleted"; readonly ownerId: OwnerId }
  | { readonly _tag: "WriteFailed"; readonly write: FailedWrite }
  | { readonly _tag: "WriteApplied"; readonly write: AppliedWrite }
  | {
      readonly _tag: "ShardPointersRepaired";
      readonly repairs: ReadonlyArray<{
        readonly repair: PointerRepair<LinkyScope>;
        readonly owner: OwnerId;
      }>;
    }
  | { readonly _tag: "ShardPointerRepairFailed"; readonly error: unknown }
  | {
      readonly _tag: "UserRelaysMigrated";
      readonly legacyServerUrls: ReadonlyArray<string>;
      readonly defaultsRemoved: boolean;
      readonly isExistingInstall: boolean;
    };

// Generate a valid Evolu `Name` (1-42 chars, alphanumeric + dash) from mnemonic
// Each user gets their own SQLite database file
const hashDbNameFromMnemonic = (mnemonic: string): string => {
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

/**
 * The name Evolu 7 gave the device's database (and its OPFS directory
 * `.<name>`) for the stored mnemonic. Evolu 8 finds that database by it to
 * move its data in, so it never changes.
 */
export const generateDbNameFromMnemonic = (mnemonic: string | null): Name =>
  Name.orThrow(mnemonic ? hashDbNameFromMnemonic(mnemonic) : "linky-anon");

const appName = AppName.orThrow("linky");
const createQuery = createQueryBuilder(LinkyEvoluSchema);
const readinessQuery = createQuery((db) =>
  db.selectFrom("shardPointer").select("id").limit(1),
);

/** Parses and deduplicates relay URLs into Evolu WebSocket transports. */
export const toEvoluTransports = (
  urls: ReadonlyArray<string>,
): ReadonlyArray<OwnerWebSocketTransport> => [
  ...new Map(
    urls.flatMap((url) => {
      const parsed = WebSocketUrlFromString.fromUnknown(url);
      return parsed.ok
        ? [[parsed.value, { type: "WebSocket" as const, url: parsed.value }]]
        : [];
    }),
  ).values(),
];

const deferDispose = (run: EvoluRun, resource: AsyncDisposable): void => {
  if ("defer" in run && typeof run.defer === "function") {
    try {
      run.defer(() => resource[Symbol.asyncDispose]());
    } catch {
      void Promise.resolve(resource[Symbol.asyncDispose]()).catch(() => {});
    }
  }
};

/**
 * Opens the Linky database owned by the mnemonic's app owner; the first time,
 * Evolu moves the device's Evolu 7 database into it before it answers
 * anything. A session without an app mnemonic opens the app owner Evolu 7
 * created for it, unless `memoryOnly` is set, in which case an ephemeral
 * in-memory owner opens without touching persistent storage or `.linky-anon`.
 */
export const openLinkyEvolu = async (
  run: EvoluRun,
  {
    mnemonic,
    relayUrls,
    memoryOnly,
    onDatabaseDeleted,
    onOwnerDeleted,
  }: {
    readonly mnemonic: string | null;
    readonly relayUrls: ReadonlyArray<string>;
    readonly memoryOnly: boolean;
    readonly onDatabaseDeleted?: () => void;
    readonly onOwnerDeleted?: (ownerId: OwnerId) => void;
  },
): Promise<LinkyEvolu> => {
  const transports = toEvoluTransports(relayUrls);
  // Where the platform offers no storage, Evolu keeps the database in memory unasked.
  if (!memoryOnly && (await run.deps.getDevicePersistence()) === "NotPersisted")
    throw new DeviceStorageUnavailableError();
  const baseConfig = {
    appName,
    indexes: linkyIndexes,
    transports,
    ...(onOwnerDeleted ? { onOwnerDeleted } : {}),
  };
  if (mnemonic !== null) {
    const appOwner = appOwnerFromMnemonic(mnemonic);
    if (appOwner === null) throw new InvalidAppMnemonic();
    const evolu = await run.ok(
      createEvolu(LinkyEvoluSchema, {
        ...baseConfig,
        evolu7Name: generateDbNameFromMnemonic(mnemonic),
        appOwner,
        memoryOnly,
        ...(onDatabaseDeleted ? { onDatabaseDeleted } : {}),
      }),
    );
    deferDispose(run, evolu);
    return evolu;
  }
  if (memoryOnly) {
    // `createEvoluApp` has no `memoryOnly` option and would touch/migrate
    // `.linky-anon` if OPFS answered after a stalled probe. Open an ephemeral
    // in-memory owner instead so temporary sessions never touch disk.
    const appOwner = createAppOwner(createOwnerSecret(run.deps));
    const evolu = await run.ok(
      createEvolu(LinkyEvoluSchema, {
        ...baseConfig,
        appOwner,
        memoryOnly: true,
        ...(onDatabaseDeleted ? { onDatabaseDeleted } : {}),
      }),
    );
    deferDispose(run, evolu);
    return evolu;
  }
  const app = await run.orThrow(
    createEvoluApp(LinkyEvoluSchema, {
      ...baseConfig,
      evolu7Name: generateDbNameFromMnemonic(null),
      auth: { type: "InstantStart" },
      createFirstAppOwner: true,
    }),
  );
  deferDispose(run, app);
  const current = app.current.get();
  if (current === null) throw new Error("Evolu opened no app owner");
  if (onDatabaseDeleted) {
    // `createEvoluApp` handles `deleteDatabase()` by replacing `app.current`.
    app.current.subscribe(() => {
      if (app.current.get()?.evolu !== current.evolu) onDatabaseDeleted();
    });
  }
  return current.evolu;
};

/**
 * Resolves once the database answers an uncached query (after any Evolu 7
 * import finishes), and rejects promptly if Evolu refuses startup or reports a
 * fatal `evoluError` (such as `DatabaseHeldError` or `OtherBuildRunningError`).
 */
export const awaitDatabaseReady = (
  evolu: Pick<LinkyEvolu, "loadQuery">,
  evoluError: ReadonlyStore<EvoluError | null>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      fn();
    };
    const checkError = () => {
      const error = evoluError.get();
      if (error !== null)
        finish(() => reject(new EvoluDatabaseRefusedError(error)));
    };
    const unsubscribe = evoluError.subscribe(checkError);
    checkError();
    if (settled) return;
    void evolu.loadQuery(readinessQuery, { cache: false }).then(
      () => finish(resolve),
      (error: unknown) => {
        const refused = evoluError.get();
        finish(() =>
          reject(
            refused !== null
              ? new EvoluDatabaseRefusedError(refused)
              : error instanceof Error
                ? error
                : new Error(String(error)),
          ),
        );
      },
    );
  });

/** Every owner currently failing a route with `ProtocolQuotaError` for this database. */
export const syncStateQuotaErrors = (
  state: SyncState | null,
  name: string,
): ReadonlyArray<{
  readonly ownerId: OwnerId;
  readonly error: ProtocolQuotaError;
}> => {
  const tenant = state?.tenants.find((t) => t.name === name);
  if (tenant?.type !== "Active") return [];
  const failures: Array<{
    readonly ownerId: OwnerId;
    readonly error: ProtocolQuotaError;
  }> = [];
  for (const owner of tenant.owners)
    if (owner.type === "Writable")
      for (const route of owner.routes)
        if (
          route.type === "Pending" &&
          route.failure?.type === "ProtocolQuotaError"
        ) {
          failures.push({ ownerId: owner.ownerId, error: route.failure });
          break;
        }
  return failures;
};

/** Reports each relay failure or skipped change of the database's owners once. */
const reportSyncFailures = (
  syncState: ReadonlyStore<SyncState | null>,
  name: string,
  onEvent: (event: LinkyEvoluEvent) => void,
): void => {
  let reported = new Set<object>();
  const report = () => {
    const tenant = syncState.get()?.tenants.find((t) => t.name === name);
    if (tenant?.type !== "Active") return;
    const current = new Set<object>();
    for (const owner of tenant.owners)
      if (owner.type === "Writable")
        for (const route of owner.routes) {
          const error =
            route.type === "Pending"
              ? route.failure
              : route.type === "Settled"
                ? route.skippedError
                : null;
          if (error !== null) {
            current.add(error);
            if (!reported.has(error))
              onEvent({
                _tag: "OwnerSyncFailed",
                ownerId: owner.ownerId,
                error: error.type,
              });
          }
        }
    reported = current;
  };
  syncState.subscribe(report);
  report();
};

const syncOwnerIds = (store: LinkyStore): Promise<ReadonlyArray<OwnerId>> =>
  Effect.runPromise(store.syncOwners()).then((owners) =>
    owners.map((owner) => owner.id),
  );

/**
 * The account's shard store over this database. The store subscribes the app
 * owner and every visible shard for its lifetime and follows its pointers, so
 * a rotation here or on another device subscribes the new shard. Pointer
 * repair runs in the background. Retention is kept in `kv`, per app owner.
 */
export const openLinkyStore = async (
  evolu: EvoluRuntime & Pick<LinkyEvolu, "appOwner">,
  {
    syncState,
    kv,
    scopes,
    hasEvoluRelay,
    memoryOnly = false,
    onOwnerDeleted,
    onEvent,
  }: {
    readonly syncState: ReadonlyStore<SyncState | null>;
    readonly kv: KeyValueStorage;
    readonly scopes: LinkyScopes;
    readonly hasEvoluRelay: boolean;
    readonly memoryOnly?: boolean;
    readonly onOwnerDeleted?: (
      listener: (ownerId: OwnerId) => void,
    ) => () => void;
    readonly onEvent?: (event: LinkyEvoluEvent) => void;
  },
): Promise<LinkyStore> => {
  const owner = evolu.appOwner;
  const key = (scope: string) =>
    `linky.shards.retainedFrom.${owner.id}.${scope}`;
  if (onEvent) reportSyncFailures(syncState, evolu.name, onEvent);
  if (onOwnerDeleted && onEvent)
    onOwnerDeleted((ownerId) => onEvent({ _tag: "OwnerDeleted", ownerId }));
  const store = createAccountStore(
    createEvoluShardDb(evolu, {
      syncState,
      hasEvoluRelay,
      ...(onOwnerDeleted ? { onOwnerDeleted } : {}),
      onWriteFailed: (write) => onEvent?.({ _tag: "WriteFailed", write }),
      onWriteApplied: (write) => onEvent?.({ _tag: "WriteApplied", write }),
    }),
    owner,
    {
      kv,
      scopes,
      hasEvoluRelay,
      memoryOnly,
      retention: {
        get: (scope) =>
          readJson(kv, key(scope), Schema.NullOr(Schema.Natural), null) ??
          undefined,
        set: (scope, first) => writeJson(kv, key(scope), first),
      },
    },
  );
  const reportSubscribed = (reason: "boot" | "rotation") => {
    if (onEvent)
      void syncOwnerIds(store).then((owners) =>
        onEvent({ _tag: "ShardsSubscribed", reason, owners }),
      );
  };
  await Effect.runPromise(store.reconcileSync());
  reportSubscribed("boot");
  store.followPointers((rotation) => {
    onEvent?.({
      _tag: "ShardRotated",
      rotation,
      owner: store.shardOwner(rotation.scope, rotation.index).id,
    });
    reportSubscribed("rotation");
  });
  store.subscribeHydration(() => {
    if (onEvent)
      void syncOwnerIds(store).then((owners) =>
        onEvent({ _tag: "AccountHydrated", owners }),
      );
  });
  void Effect.runPromise(store.repairPointers()).then(
    (repairs) => {
      if (repairs.length > 0)
        onEvent?.({
          _tag: "ShardPointersRepaired",
          repairs: repairs.map((repair) => ({
            repair,
            owner: store.shardOwner(repair.scope, repair.to).id,
          })),
        });
    },
    (error: unknown) => onEvent?.({ _tag: "ShardPointerRepairFailed", error }),
  );
  return store;
};

/**
 * Opens an app's sharded Linky database from relay settings, waits for SQLite
 * to answer (failing promptly on refusals like `DatabaseHeldError`), and
 * returns the initialized store. Shared by Fazole and onchain-operator.
 */
export const openLinkyDatabase = async (
  run: EvoluRun,
  {
    mnemonic,
    kv,
    envDefaults,
    recommended,
    scopes,
    hasStoredAccount = false,
    onEvent,
    onDatabaseDeleted,
  }: {
    readonly mnemonic: string;
    readonly kv: KeyValueStorage;
    readonly envDefaults: ReadonlyArray<string>;
    readonly recommended: ReadonlyArray<string>;
    readonly scopes: LinkyScopes;
    readonly hasStoredAccount?: boolean;
    readonly onEvent?: (event: LinkyEvoluEvent) => void;
    readonly onDatabaseDeleted?: () => void;
  },
): Promise<LinkyStore> => {
  const relayUrls = makeEvoluRelaySettings(kv, {
    envDefaults,
    recommended,
    hasStoredAccount,
    ...(onEvent ? { onEvent } : {}),
  }).activeUrls();
  const hasEvoluRelay = toEvoluTransports(relayUrls).length > 0;
  const ownerDeletedListeners = new Set<(ownerId: OwnerId) => void>();
  const evolu = await openLinkyEvolu(run, {
    mnemonic,
    relayUrls,
    memoryOnly: false,
    onOwnerDeleted: (ownerId) => {
      for (const listener of ownerDeletedListeners) listener(ownerId);
    },
    ...(onDatabaseDeleted ? { onDatabaseDeleted } : {}),
  });
  await awaitDatabaseReady(evolu, run.deps.evoluError);
  return openLinkyStore(evolu, {
    syncState: run.deps.syncState,
    kv,
    scopes,
    hasEvoluRelay,
    onOwnerDeleted: (listener) => {
      ownerDeletedListeners.add(listener);
      return () => {
        ownerDeletedListeners.delete(listener);
      };
    },
    ...(onEvent ? { onEvent } : {}),
  });
};
