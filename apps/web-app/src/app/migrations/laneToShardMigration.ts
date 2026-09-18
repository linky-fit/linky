// Legacy migration; removal gate in docs/architecture.md
//
// Copies every visible row of the old Evolu owner lanes (one BIP-85 AppOwner
// per scope and index, plus the app owner itself for nsec-only logins and
// pre-lane rows) into the active shard of its scope through the linksync
// store's legacy ingest, which is idempotent by id and keeps the newer copy.
// Contact chat state becomes a `conversation` row, messages and reactions
// point at that conversation, `cashuToken` rows go through linkshu's legacy
// ingest, and transactions lose their deprecated columns.
//
// The same routine is the mixed-version grace period: an older app version
// keeps writing to the lanes, so each boot and subsequent legacy query change
// inside the grace period re-runs it over the rows the device holds. There is no watermark: a row
// that syncs in late carries an old `updatedAt`, so a watermark would skip
// it, while the ingest's per-row comparison costs one map lookup.
//
// This module is the only caller of the old lane derivation.

import {
  activeNostrIdentityId,
  appOwnerFromMnemonic,
  directConversationIdFor,
  linkyTableColumns,
  makeSettingsRepository,
  NonEmptyString100,
  NonNegativeInt,
  settingIdFor,
  shardPointerId,
  ShardPointerId,
  type Columns,
  type ContactId,
  type LinkyDbSchema,
  type LinkyScope,
  type LinkyStore,
  type LinkyTable,
  type Row,
  type AppOwner,
  type SystemColumns,
  type TableOf,
} from "@linky/linksync";
import type { LegacyTokenRow } from "@linky/linkshu";
import { Effect } from "effect";
import type {
  CashuOperationRow,
  CashuProofRow,
  CashuTokenRow,
  LegacyContactRow,
  NostrIdentityRow,
  NostrMessageRow,
  NostrReactionRow,
  OwnerMetaRow,
  TransactionRow,
} from "../../evolu";
import { deriveEvoluOwnerMnemonicFromSlip39 } from "../../utils/slip39Nostr";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";
import { toLegacyTokenRow } from "./legacyTokenRow";
import { readRowOwnerId } from "../lib/rowOwnerId";

export const LANE_MIGRATION_DONE_STORAGE_KEY = "linky.laneMigration.done.v1";
/** Synced through the `setting` table so every device agrees on the cutoff. */
export const LANE_MIGRATION_CUTOFF_SETTING_KEY = "laneMigration.cutoffMs";
export const LANE_MIGRATION_GRACE_PERIOD_MS = 180 * 24 * 60 * 60 * 1000;

const ONBOARDING_TUTORIAL_SETTING_KEY = "onboardingTutorial";
const ONBOARDING_TUTORIAL_DISMISSED = "dismissed";
/** The default mint used to be an `ownerMeta` row; it is the `defaultMint` setting now. */
export const DEFAULT_MINT_SETTING_KEY = "defaultMint";

export const LEGACY_LANE_SCOPES = [
  "contacts",
  "cashu",
  "messages",
  "transactions",
] as const;
export type LegacyLaneScope = (typeof LEGACY_LANE_SCOPES)[number];
export type LegacyLaneIndexes = Readonly<Record<LegacyLaneScope, number>>;

/**
 * localStorage mirrors the old lane code kept per scope. Nothing reads them
 * any more; logout clears them so an old install leaves nothing behind.
 */
const LEGACY_LANE_STORAGE_KEYS = [
  "linky.evolu.contacts_owner_index.v1",
  "linky.evolu.cashu_owner_index.v1",
  "linky.evolu.messages_owner_index.v1",
  "linky.evolu.transactions_owner_index.v1",
  "linky.evolu.messages_owner_baseline_count.v1",
  "linky.evolu.messages_owner_last_rotated_at_ms.v1",
];

export const clearLegacyLaneStorage = (): void => {
  for (const key of LEGACY_LANE_STORAGE_KEYS) safeLocalStorageRemove(key);
};

export const isLaneMigrationDoneLocally = (): boolean =>
  safeLocalStorageGet(LANE_MIGRATION_DONE_STORAGE_KEY) === "1";

export const markLaneMigrationDoneLocally = (): void =>
  safeLocalStorageSet(LANE_MIGRATION_DONE_STORAGE_KEY, "1");

/** Null cutoff means no device has migrated yet, so the lanes are still live. */
export const isLaneGracePeriodActive = (
  cutoffMs: number | null,
  nowMs: number,
): boolean =>
  cutoffMs === null || nowMs < cutoffMs + LANE_MIGRATION_GRACE_PERIOD_MS;

export const readLaneMigrationCutoffMs = (
  store: LinkyStore,
): Effect.Effect<number | null> =>
  Effect.map(
    makeSettingsRepository(store).get(LANE_MIGRATION_CUTOFF_SETTING_KEY),
    (value) => {
      const parsed = Number(value);
      return value !== null && Number.isFinite(parsed) && parsed > 0
        ? parsed
        : null;
    },
  );

/**
 * The old pointer value: JSON `{ index, ... }` from later versions, or the
 * plain `"<scope>-N"` the first ones wrote. Anything else reads as no pointer.
 */
export const legacyPointerIndex = (
  value: string | null,
  scope: LegacyLaneScope,
): number | null => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const plain = new RegExp(`^${scope}-(\\d+)$`).exec(trimmed);
  if (plain) return Number(plain[1]);
  if (!trimmed.startsWith("{")) return null;
  try {
    const index = Reflect.get(Object(JSON.parse(trimmed)), "index");
    return typeof index === "number" && Number.isInteger(index) && index >= 0
      ? index
      : null;
  } catch {
    return null;
  }
};

/** The active lane index per scope as the synced `ownerMeta` pointers say; 0 without one. */
export const readLegacyLaneIndexes = (
  ownerMetaRows: ReadonlyArray<OwnerMetaRow>,
  metaOwnerId: string,
): LegacyLaneIndexes => {
  const indexes = { contacts: 0, cashu: 0, messages: 0, transactions: 0 };
  for (const scope of LEGACY_LANE_SCOPES) {
    const synced = ownerMetaRows
      .filter(
        (row) =>
          readRowOwnerId(row) === metaOwnerId &&
          row.scope === scope &&
          row.isDeleted !== 1,
      )
      .map((row) => legacyPointerIndex(row.value, scope) ?? 0);
    indexes[scope] = Math.max(0, ...synced);
  }
  return indexes;
};

/** The identity owner and every lane 0..index of every rotating scope. */
export const deriveLegacyLaneOwners = async (
  slip39Seed: string,
  indexes: LegacyLaneIndexes,
): Promise<ReadonlyArray<AppOwner>> => {
  const requests = [
    { role: "identity" as const, index: 0 },
    ...LEGACY_LANE_SCOPES.flatMap((scope) =>
      Array.from({ length: indexes[scope] + 1 }, (_, index) => ({
        role: scope,
        index,
      })),
    ),
  ];
  const mnemonics = await Promise.all(
    requests.map((request) =>
      deriveEvoluOwnerMnemonicFromSlip39(
        slip39Seed,
        request.role,
        request.index,
      ),
    ),
  );
  return mnemonics.flatMap((mnemonic) => {
    const owner = mnemonic === null ? null : appOwnerFromMnemonic(mnemonic);
    return owner === null ? [] : [owner];
  });
};

export interface LegacyLaneSnapshot {
  readonly contacts: ReadonlyArray<LegacyContactRow>;
  readonly messages: ReadonlyArray<NostrMessageRow>;
  readonly reactions: ReadonlyArray<NostrReactionRow>;
  readonly tokens: ReadonlyArray<CashuTokenRow>;
  readonly proofs: ReadonlyArray<CashuProofRow>;
  readonly operations: ReadonlyArray<CashuOperationRow>;
  readonly transactions: ReadonlyArray<TransactionRow>;
  readonly identities: ReadonlyArray<NostrIdentityRow>;
  readonly ownerMeta: ReadonlyArray<OwnerMetaRow>;
}

export const legacySnapshotKey = (
  snapshot: LegacyLaneSnapshot,
  legacyOwnerIds: ReadonlySet<string>,
): string =>
  JSON.stringify(
    Object.values(snapshot).map((rows: ReadonlyArray<LegacyRow>) =>
      rows.filter((row) => legacyOwnerIds.has(row.ownerId)),
    ),
  );

type LegacyRow = { readonly id: string } & SystemColumns;
/** Any legacy row with extra columns the target table may or may not have. */
type ShardRowInput = SystemColumns & Readonly<Record<string, unknown>>;

const SYSTEM_COLUMNS = ["ownerId", "createdAt", "updatedAt", "isDeleted"];

/** Columns a shard row must carry for Evolu to accept the upsert; a synced legacy row can still be missing them. */
const REQUIRED_COLUMNS: {
  readonly [T in LinkyTable]: ReadonlyArray<keyof LinkyDbSchema[T] & string>;
} = {
  shardPointer: ["scope", "index"],
  setting: ["key", "value"],
  nostrIdentity: ["nsec"],
  contact: [],
  conversation: ["kind"],
  message: ["conversationId", "direction", "content", "wrapId", "createdAtSec"],
  reaction: [
    "conversationId",
    "messageId",
    "reactorPubkey",
    "emoji",
    "createdAtSec",
    "wrapId",
  ],
  cashuProof: ["mint", "unit", "keysetId", "amount", "secret", "c", "state"],
  cashuOperation: ["kind", "status", "mint", "unit", "amount", "createdAtSec"],
  transaction: ["createdAtSec", "direction", "status"],
};

// The overload types the picked row against the package schema; the
// implementation keeps only that table's columns and rejects a row missing a
// required one, which is the guard Evolu would otherwise apply at write time.
function toShardRow<T extends LinkyTable>(
  table: T,
  row: ShardRowInput,
): Row<LinkyDbSchema[T]> | null;
function toShardRow(
  table: LinkyTable,
  row: ShardRowInput,
): Row<Columns> | null {
  const picked = Object.fromEntries(
    linkyTableColumns[table].map((column) => [
      column,
      Reflect.get(row, column) ?? null,
    ]),
  );
  const id = picked.id;
  if (typeof id !== "string" || !id) return null;
  if (REQUIRED_COLUMNS[table].some((column) => picked[column] === null))
    return null;
  return {
    ...picked,
    id,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDeleted: row.isDeleted,
  };
}

/**
 * One row per id across the lanes. Two lanes can hold the same id (a proof
 * ingested on two devices, or a phantom row holding only patched columns),
 * so copies fold oldest to newest: a newer copy overrides the columns it
 * carries and leaves the rest, and the newest copy decides `isDeleted`.
 */
function coalesceById<R extends LegacyRow>(
  rows: ReadonlyArray<R>,
): ReadonlyArray<R>;
function coalesceById(
  rows: ReadonlyArray<LegacyRow>,
): ReadonlyArray<LegacyRow> {
  const byId = new Map<string, LegacyRow>();
  const oldestFirst = [...rows].sort((a, b) =>
    a.updatedAt.localeCompare(b.updatedAt),
  );
  for (const row of oldestFirst) {
    const previous = byId.get(row.id);
    if (previous === undefined) {
      byId.set(row.id, row);
      continue;
    }
    const merged: Record<string, unknown> = { ...previous };
    for (const [column, value] of Object.entries(row)) {
      if (value !== null || SYSTEM_COLUMNS.includes(column))
        merged[column] = value;
    }
    byId.set(row.id, {
      ...merged,
      id: row.id,
      ownerId: row.ownerId,
      createdAt: previous.createdAt,
      updatedAt: row.updatedAt,
      isDeleted: row.isDeleted,
    });
  }
  return [...byId.values()];
}

const DIRECT = NonEmptyString100.orThrow("direct");

const hasChatState = (contact: LegacyContactRow): boolean =>
  contact.archivedAtSec !== null ||
  contact.chatLastSeenAtSec !== null ||
  contact.chatPeerSeenSinceSec !== null ||
  contact.chatPeerSeenAtSec !== null;

/** The direct conversation a contact's chat columns describe; a bare one when only messages exist. */
const conversationOf = (
  contactId: ContactId,
  source: ShardRowInput,
  contact: LegacyContactRow | null,
): Row<LinkyDbSchema["conversation"]> | null =>
  toShardRow("conversation", {
    ...source,
    id: directConversationIdFor(contactId),
    kind: DIRECT,
    contactId,
    archivedAtSec: contact?.archivedAtSec ?? null,
    lastSeenAtSec: contact?.chatLastSeenAtSec ?? null,
    peerSeenSinceSec: contact?.chatPeerSeenSinceSec ?? null,
    peerSeenAtSec: contact?.chatPeerSeenAtSec ?? null,
  });

/** Old rows carried a category instead of a method; the migration fills the method the category implies. */
const methodFromLegacyCategory = (category: string | null): string | null => {
  if (category === "contacts") return "cashu_chat";
  if (category === "lightning") return "lightning_invoice";
  return null;
};

export interface TableIngestCount {
  readonly scope: string;
  readonly table: string;
  readonly ingested: number;
  /** Rows that could not become a shard row (a required column missing, a reaction without its message). */
  readonly skipped: number;
}

export interface LaneMigrationReport {
  readonly counts: ReadonlyArray<TableIngestCount>;
  readonly cutoffMs: number;
  readonly pointersWritten: number;
}

export interface LaneMigrationInput {
  readonly store: LinkyStore;
  readonly snapshot: LegacyLaneSnapshot;
  /** The owners whose rows are legacy: the derived lanes plus the app owner. */
  readonly legacyOwnerIds: ReadonlySet<string>;
  /** linkshu's `Tokens.ingestLegacyRows` over the shard wallet; called only with rows. */
  readonly ingestLegacyTokens: (
    rows: ReadonlyArray<LegacyTokenRow>,
  ) => Promise<void>;
  readonly nowMs: number;
}

// Evolu stamps `updatedAt` only on update; a row that was only ever upserted
// carries null there at runtime, whatever the row type says.
const withLastChangeTime = <R extends LegacyRow>(row: R): R => ({
  ...row,
  updatedAt: row.updatedAt ?? row.createdAt,
});

const visibleRows = <R extends LegacyRow>(
  rows: ReadonlyArray<R>,
  legacyOwnerIds: ReadonlySet<string>,
): ReadonlyArray<R> =>
  coalesceById(
    rows
      .filter((row) => legacyOwnerIds.has(row.ownerId))
      .map(withLastChangeTime),
  );

const nonNull = <A>(values: ReadonlyArray<A | null>): ReadonlyArray<A> =>
  values.filter((value): value is A => value !== null);

/**
 * Ingests the snapshot into the shards, writes the pointers and the cutoff
 * when they are missing, and reports what happened. Safe to run on every
 * boot: rows already in a shard with the same or a newer `updatedAt` are
 * left alone, and existing pointers and settings win.
 */
export const runLaneToShardMigration = ({
  store,
  snapshot,
  legacyOwnerIds,
  ingestLegacyTokens,
  nowMs,
}: LaneMigrationInput): Promise<LaneMigrationReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const counts: TableIngestCount[] = [];
      const ingest = <Scope extends LinkyScope, T extends TableOf<Scope>>(
        scope: Scope,
        table: T,
        candidates: ReadonlyArray<Row<LinkyDbSchema[T]> | null>,
      ) => {
        const rows = nonNull(candidates);
        return Effect.map(store.ingest(scope, table, rows), ({ ingested }) => {
          counts.push({
            scope,
            table,
            ingested,
            skipped: candidates.length - rows.length,
          });
        });
      };

      const contacts = visibleRows(snapshot.contacts, legacyOwnerIds);
      const messages = visibleRows(snapshot.messages, legacyOwnerIds);
      const reactions = visibleRows(snapshot.reactions, legacyOwnerIds);
      const contactById = new Map(
        contacts.map((contact) => [contact.id, contact]),
      );

      yield* ingest(
        "contacts",
        "contact",
        contacts.map((contact) => toShardRow("contact", contact)),
      );

      const conversationSources = new Map<ContactId, ShardRowInput>();
      for (const contact of contacts)
        if (hasChatState(contact)) conversationSources.set(contact.id, contact);
      for (const message of messages)
        if (
          message.contactId !== null &&
          !conversationSources.has(message.contactId)
        )
          conversationSources.set(
            message.contactId,
            contactById.get(message.contactId) ?? message,
          );
      yield* ingest(
        "messages",
        "conversation",
        [...conversationSources].map(([contactId, source]) =>
          conversationOf(contactId, source, contactById.get(contactId) ?? null),
        ),
      );
      yield* ingest(
        "messages",
        "message",
        messages.map((message) =>
          message.contactId === null
            ? null
            : toShardRow("message", {
                ...message,
                conversationId: directConversationIdFor(message.contactId),
              }),
        ),
      );
      const contactByRumorId = new Map(
        messages.flatMap((message) =>
          message.rumorId === null || message.contactId === null
            ? []
            : [[message.rumorId, message.contactId] as const],
        ),
      );
      yield* ingest(
        "messages",
        "reaction",
        reactions.map((reaction) => {
          const contactId =
            reaction.messageId === null
              ? undefined
              : contactByRumorId.get(reaction.messageId);
          return contactId === undefined
            ? null
            : toShardRow("reaction", {
                ...reaction,
                conversationId: directConversationIdFor(contactId),
              });
        }),
      );

      yield* ingest(
        "cashu",
        "cashuProof",
        visibleRows(snapshot.proofs, legacyOwnerIds).map((proof) =>
          toShardRow("cashuProof", proof),
        ),
      );
      yield* ingest(
        "cashu",
        "cashuOperation",
        visibleRows(snapshot.operations, legacyOwnerIds).map((operation) =>
          toShardRow("cashuOperation", operation),
        ),
      );
      const tokens = visibleRows(snapshot.tokens, legacyOwnerIds);
      const legacyTokenRows = nonNull(tokens.map(toLegacyTokenRow));
      if (legacyTokenRows.length > 0)
        yield* Effect.promise(() => ingestLegacyTokens(legacyTokenRows));
      counts.push({
        scope: "cashu",
        table: "cashuToken",
        ingested: legacyTokenRows.length,
        skipped: tokens.length - legacyTokenRows.length,
      });

      yield* ingest(
        "transactions",
        "transaction",
        visibleRows(snapshot.transactions, legacyOwnerIds).map((transaction) =>
          toShardRow("transaction", {
            ...transaction,
            method:
              transaction.method ??
              methodFromLegacyCategory(transaction.category),
          }),
        ),
      );

      const newestIdentity = [
        ...visibleRows(snapshot.identities, legacyOwnerIds),
      ]
        .filter((identity) => identity.isDeleted !== 1)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      yield* ingest(
        "identity",
        "nostrIdentity",
        newestIdentity === undefined
          ? []
          : [
              toShardRow("nostrIdentity", {
                ...newestIdentity,
                id: activeNostrIdentityId,
              }),
            ],
      );

      const ownerMeta = visibleRows(snapshot.ownerMeta, legacyOwnerIds);
      const dismissedTutorial = ownerMeta.find(
        (row) =>
          row.scope === ONBOARDING_TUTORIAL_SETTING_KEY &&
          row.value === ONBOARDING_TUTORIAL_DISMISSED,
      );
      const defaultMint = ownerMeta.find(
        (row) => row.scope === DEFAULT_MINT_SETTING_KEY && row.value !== null,
      );
      yield* ingest("meta", "setting", [
        ...(dismissedTutorial === undefined
          ? []
          : [
              toShardRow("setting", {
                ...dismissedTutorial,
                id: settingIdFor(ONBOARDING_TUTORIAL_SETTING_KEY),
                key: ONBOARDING_TUTORIAL_SETTING_KEY,
                value: ONBOARDING_TUTORIAL_DISMISSED,
              }),
            ]),
        ...(defaultMint === undefined
          ? []
          : [
              toShardRow("setting", {
                ...defaultMint,
                id: settingIdFor(DEFAULT_MINT_SETTING_KEY),
                key: DEFAULT_MINT_SETTING_KEY,
              }),
            ]),
      ]);

      const pointers = yield* store.rows("meta", "shardPointer");
      let pointersWritten = 0;
      for (const scope of LEGACY_LANE_SCOPES) {
        if (pointers.some((pointer) => pointer.scope === scope)) continue;
        const id = ShardPointerId.fromUnknown(shardPointerId(scope));
        if (!id.ok) continue;
        yield* store.insert("meta", "shardPointer", {
          id: id.value,
          scope: NonEmptyString100.orThrow(scope),
          index: NonNegativeInt.orThrow(0),
        });
        pointersWritten += 1;
      }

      const settings = makeSettingsRepository(store);
      const existingCutoff = yield* readLaneMigrationCutoffMs(store);
      if (existingCutoff === null)
        yield* settings.set(LANE_MIGRATION_CUTOFF_SETTING_KEY, String(nowMs));

      return { counts, cutoffMs: existingCutoff ?? nowMs, pointersWritten };
    }),
  );
