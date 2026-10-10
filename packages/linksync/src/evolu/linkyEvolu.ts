import * as Evolu from "@evolu/common";
import { createEvolu, SimpleName } from "@evolu/common";
import { ContactId } from "@linky-fit/domain";
import { Effect, Schema } from "effect";
import {
  appOwnerFromMnemonic,
  type PointerRepair,
  type ShardRotation,
} from "../core";
import {
  LinkySchema,
  type LinkyScope,
  type LinkyScopes,
  type LinkyStore,
} from "../model";
import type { PageMessage, WorkerMessage } from "./dbWorker";
import { createEvoluShardDb, type UnconfirmedWrite } from "./evoluShardDb";
import { createAccountStore } from "./firstHydration";
import { readJson, writeJson, type KeyValueStorage } from "./keyValueStorage";
import {
  trackOwnerSync,
  type OwnerSync,
  type OwnerSyncFailure,
} from "./ownerSync";

const CashuTokenId = Evolu.id("CashuToken");
export type CashuTokenId = typeof CashuTokenId.Type;

const NostrMessageId = Evolu.id("NostrMessage");

const NostrReactionId = Evolu.id("NostrReaction");

const OwnerMetaId = Evolu.id("OwnerMeta");

/**
 * The Linky database schema: `LinkySchema` plus the legacy lane tables
 * (`nostrMessage`, `nostrReaction`, `cashuToken`, `ownerMeta`) and the legacy
 * columns older versions wrote (read cursors on `contact`, `category` and
 * `phase` on `transaction`), all of which only the lane migration reads. The
 * package's branded ids are the source of truth; only the legacy tables keep
 * ids of their own.
 * Legacy schema removal gate in app/migrations/AGENTS.md (web app).
 */
export const LinkyEvoluSchema = {
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

export type LinkyEvolu = Evolu.Evolu<typeof LinkyEvoluSchema>;

/** What the package reports for the inspector; the consumer turns each into a row. */
export type LinkyEvoluEvent =
  | { readonly _tag: "OwnerSyncFailed"; readonly failure: OwnerSyncFailure }
  | {
      readonly _tag: "ShardRotated";
      readonly rotation: ShardRotation<LinkyScope>;
      readonly owner: Evolu.OwnerId;
    }
  | {
      readonly _tag: "ShardsSubscribed";
      readonly reason: "boot" | "rotation";
      /** The app owner first, then every subscribed shard owner. */
      readonly owners: ReadonlyArray<Evolu.OwnerId>;
    }
  | {
      readonly _tag: "AccountHydrated";
      readonly owners: ReadonlyArray<Evolu.OwnerId>;
    }
  | { readonly _tag: "WriteUnconfirmed"; readonly write: UnconfirmedWrite }
  | {
      readonly _tag: "ShardPointersRepaired";
      readonly repairs: ReadonlyArray<{
        readonly repair: PointerRepair<LinkyScope>;
        readonly owner: Evolu.OwnerId;
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
 * The name of the device's database (and of its OPFS directory) for the
 * stored mnemonic. Existing databases are found by it, so it never changes.
 */
export const generateDbNameFromMnemonic = (
  mnemonic: string | null,
): SimpleName => {
  const dbName = mnemonic ? hashDbNameFromMnemonic(mnemonic) : "linky-anon";
  const validatedName = SimpleName.from(dbName);
  return validatedName.ok
    ? validatedName.value
    : SimpleName.orThrow("linky-default");
};

/**
 * Opens the Linky database over a worker started with `runOwnerSyncDbWorker`,
 * owned by the mnemonic's app owner (Evolu's own when `null`).
 */
export const createLinkyEvolu = ({
  evoluDeps,
  createWorker,
  mnemonic,
  transports,
  inMemory,
  enableLogging,
  onEvent,
}: {
  readonly evoluDeps: Omit<Evolu.EvoluDeps, "createDbWorker">;
  readonly createWorker: (
    name: SimpleName,
  ) => Evolu.Worker<PageMessage, WorkerMessage>;
  readonly mnemonic: string | null;
  readonly transports: ReadonlyArray<{ type: "WebSocket"; url: string }>;
  readonly inMemory: boolean;
  readonly enableLogging: boolean;
  readonly onEvent?: (event: LinkyEvoluEvent) => void;
}): { readonly evolu: LinkyEvolu; readonly ownerSync: OwnerSync } => {
  const { createDbWorker, ownerSync } = trackOwnerSync(createWorker);
  ownerSync.subscribeFailures((failure) =>
    onEvent?.({ _tag: "OwnerSyncFailed", failure }),
  );
  const externalAppOwner = mnemonic ? appOwnerFromMnemonic(mnemonic) : null;
  const evolu = createEvolu({ ...evoluDeps, createDbWorker })(
    LinkyEvoluSchema,
    {
      name: generateDbNameFromMnemonic(mnemonic),
      transports,
      enableLogging,
      inMemory,
      ...(externalAppOwner ? { externalAppOwner } : {}),
    },
  );
  return { evolu, ownerSync };
};

const syncOwnerIds = (
  store: LinkyStore,
): Promise<ReadonlyArray<Evolu.OwnerId>> =>
  Effect.runPromise(store.syncOwners()).then((owners) =>
    owners.map((owner) => owner.id),
  );

/**
 * The account's shard store over this database. Resolves once the app owner
 * is known and the local database has answered a query; `appOwner` alone
 * resolves before the database worker is up. The store subscribes the app
 * owner and every visible shard for its lifetime and follows its pointers, so
 * a rotation here or on another device subscribes the new shard. Pointer
 * repair runs in the background. Retention is kept in `kv`, per app owner.
 */
export const openLinkyStore = async (
  evolu: LinkyEvolu,
  ownerSync: OwnerSync,
  {
    kv,
    scopes,
    hasEvoluRelay,
    onEvent,
  }: {
    readonly kv: KeyValueStorage;
    readonly scopes: LinkyScopes;
    readonly hasEvoluRelay: boolean;
    readonly onEvent?: (event: LinkyEvoluEvent) => void;
  },
): Promise<LinkyStore> => {
  const [owner] = await Promise.all([
    evolu.appOwner,
    /* eslint-disable no-restricted-syntax -- waits for the database worker before any ShardDb exists */
    evolu.loadQuery(
      evolu.createQuery((db) =>
        db.selectFrom("shardPointer").select("id").limit(1),
      ),
    ),
    /* eslint-enable no-restricted-syntax */
  ]);
  const key = (scope: string) =>
    `linky.shards.retainedFrom.${owner.id}.${scope}`;
  const store = createAccountStore(
    createEvoluShardDb(evolu, ownerSync, {
      onWriteUnconfirmed: (write) =>
        onEvent?.({ _tag: "WriteUnconfirmed", write }),
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
