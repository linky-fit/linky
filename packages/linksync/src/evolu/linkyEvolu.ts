import type {
  EvoluDeps,
  OwnerId,
  ReadonlyStore,
  Run,
  SyncState,
} from "@evolu/common";
import {
  AppName,
  createEvolu,
  createEvoluApp,
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

// Generate a valid SimpleName (1-42 chars, alphanumeric + dash) from mnemonic
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

const toTransports = (urls: ReadonlyArray<string>) => [
  ...new Map(
    urls.flatMap((url) => {
      const parsed = WebSocketUrlFromString.fromUnknown(url);
      return parsed.ok
        ? [[parsed.value, { type: "WebSocket" as const, url: parsed.value }]]
        : [];
    }),
  ).values(),
];

/**
 * Opens the Linky database owned by the mnemonic's app owner; the first time,
 * Evolu moves the device's Evolu 7 database into it before it answers
 * anything. A session without a valid mnemonic opens the app owner Evolu 7
 * created for it, which Evolu keeps on the device from then on.
 */
export const openLinkyEvolu = async (
  run: EvoluRun,
  {
    mnemonic,
    relayUrls,
    memoryOnly,
  }: {
    readonly mnemonic: string | null;
    readonly relayUrls: ReadonlyArray<string>;
    /** Applies only to a session with a mnemonic; Evolu decides for the others. */
    readonly memoryOnly: boolean;
  },
): Promise<LinkyEvolu> => {
  const config = {
    appName,
    evolu7Name: generateDbNameFromMnemonic(mnemonic),
    indexes: linkyIndexes,
    transports: toTransports(relayUrls),
  };
  // Where the platform offers no storage, Evolu keeps the database in memory unasked.
  if (!memoryOnly && (await run.deps.getDevicePersistence()) === "NotPersisted")
    throw new Error("Device storage is unavailable");
  const appOwner = mnemonic === null ? null : appOwnerFromMnemonic(mnemonic);
  if (appOwner !== null)
    return run.ok(
      createEvolu(LinkyEvoluSchema, { ...config, appOwner, memoryOnly }),
    );
  const app = await run.orThrow(
    createEvoluApp(LinkyEvoluSchema, {
      ...config,
      auth: { type: "InstantStart" },
      createFirstAppOwner: true,
    }),
  );
  const current = app.current.get();
  if (current === null) throw new Error("Evolu opened no app owner");
  return current.evolu;
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
    onEvent,
  }: {
    readonly syncState: ReadonlyStore<SyncState | null>;
    readonly kv: KeyValueStorage;
    readonly scopes: LinkyScopes;
    readonly hasEvoluRelay: boolean;
    readonly onEvent?: (event: LinkyEvoluEvent) => void;
  },
): Promise<LinkyStore> => {
  const owner = evolu.appOwner;
  const key = (scope: string) =>
    `linky.shards.retainedFrom.${owner.id}.${scope}`;
  if (onEvent) reportSyncFailures(syncState, evolu.name, onEvent);
  const store = createAccountStore(
    createEvoluShardDb(evolu, {
      syncState,
      hasEvoluRelay,
      onWriteFailed: (write) => onEvent?.({ _tag: "WriteFailed", write }),
      onWriteApplied: (write) => onEvent?.({ _tag: "WriteApplied", write }),
    }),
    owner,
    {
      kv,
      scopes,
      hasEvoluRelay,
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
