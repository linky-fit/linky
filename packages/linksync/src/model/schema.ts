import type { EvoluSchema, InferType } from "@evolu/common";
import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  NonNegativeInt,
  nullOr,
  PositiveInt,
  SqliteBoolean,
} from "@evolu/common";
import type { Row, TableColumns } from "../core";
import {
  CashuOperationId,
  CashuProofId,
  ContactId,
  ConversationId,
  MessageId,
  NostrIdentityId,
  ReactionId,
  RecurringPaymentId,
  SettingId,
  ShardPointerId,
  TransactionId,
} from "@linky/domain";

/**
 * Linky's synced data model, the shape every device converges on. System
 * columns (`createdAt`, `updatedAt`, `isDeleted`, `ownerId`) are added by
 * Evolu. Which owner a row lives in is the shard store's business; nothing
 * here knows about shards.
 */
export const LinkySchema = {
  /** Meta scope: which shard index each scope writes to. */
  shardPointer: {
    id: ShardPointerId,
    scope: NonEmptyString100,
    index: NonNegativeInt,
    rotatedAtMs: nullOr(PositiveInt),
  },
  /** Meta scope: small synced key/value state (onboarding flags, migration marks). */
  setting: {
    id: SettingId,
    key: NonEmptyString100,
    value: NonEmptyString1000,
  },
  /** Identity scope: the active Nostr key mirrored for other devices. */
  nostrIdentity: {
    id: NostrIdentityId,
    // Bech32 NIP-19 secret key, must start with "nsec".
    nsec: NonEmptyString1000,
    npub: nullOr(NonEmptyString1000),
    // "derived" | "custom"
    source: nullOr(NonEmptyString100),
    switchedAtSec: nullOr(PositiveInt),
  },
  /** Contacts scope: the profile and the user's overrides, no chat state. */
  contact: {
    id: ContactId,
    name: nullOr(NonEmptyString1000),
    // "1" once the user typed a custom name; profile updates then leave `name` alone.
    nameSetByUser: nullOr(SqliteBoolean),
    npub: nullOr(NonEmptyString1000),
    lnAddress: nullOr(NonEmptyString1000),
    // "1" once the user typed a custom lightning address; profile updates
    // then leave `lnAddress` alone until the override is cleared.
    lnAddressSetByUser: nullOr(SqliteBoolean),
    // Contact-list grouping; unrelated to chat groups.
    groupName: nullOr(NonEmptyString1000),
    groupNamesJson: nullOr(NonEmptyString1000),
  },
  /** Messages scope: one chat, its read cursor, and its archive state. */
  conversation: {
    id: ConversationId,
    // "direct" | "group"
    kind: NonEmptyString100,
    // Direct chats: the contact; `directConversationIdFor` derives the id from it.
    contactId: nullOr(ContactId),
    // Group chats (future): JSON array of participant pubkeys.
    participantsJson: nullOr(NonEmptyString),
    archivedAtSec: nullOr(PositiveInt),
    // Read cursor: created_at (seconds) of the newest message the user has seen.
    lastSeenAtSec: nullOr(PositiveInt),
    // Peer's reported seen window (createdAtSec bounds from their latest read
    // receipt): our outgoing messages in (since, upTo] render as seen.
    peerSeenSinceSec: nullOr(PositiveInt),
    peerSeenAtSec: nullOr(PositiveInt),
  },
  message: {
    id: MessageId,
    conversationId: ConversationId,
    // "in" | "out"
    direction: NonEmptyString100,
    // Decrypted plaintext message.
    content: NonEmptyString,
    // Gift-wrapped event id (kind 1059) used for de-duplication.
    wrapId: NonEmptyString1000,
    // Inner (rumor) event id (kind 14, unsigned) if available.
    rumorId: nullOr(NonEmptyString1000),
    // Sender pubkey hex (64 chars) of the inner message; null for local-only placeholders.
    pubkey: nullOr(NonEmptyString1000),
    // created_at (seconds) from the inner event when available.
    createdAtSec: PositiveInt,
    // Client-generated id for optimistic send/ack matching.
    clientId: nullOr(NonEmptyString1000),
    // "sent" | "pending"
    status: nullOr(NonEmptyString100),
    // "1" for local-only placeholders.
    localOnly: nullOr(NonEmptyString100),
    // Reply metadata (NIP-10).
    replyToId: nullOr(NonEmptyString1000),
    replyToContent: nullOr(NonEmptyString),
    rootMessageId: nullOr(NonEmptyString1000),
    // Edit metadata.
    editedAtSec: nullOr(PositiveInt),
    editedFromId: nullOr(NonEmptyString1000),
    // "1" if the message content was edited.
    isEdited: nullOr(NonEmptyString100),
    // First known message content before edits.
    originalContent: nullOr(NonEmptyString),
  },
  reaction: {
    id: ReactionId,
    // A forgotten shard takes its reactions with it.
    conversationId: ConversationId,
    // Target message rumor id.
    messageId: NonEmptyString1000,
    reactorPubkey: NonEmptyString1000,
    emoji: NonEmptyString100,
    createdAtSec: PositiveInt,
    // Gift-wrapped event id carrying the reaction or delete.
    wrapId: NonEmptyString1000,
    // Client-generated id for optimistic send/ack matching.
    clientId: nullOr(NonEmptyString1000),
    // "sent" | "pending"
    status: nullOr(NonEmptyString100),
  },
  /** Cashu scope: the wallet inventory, one row per proof, id derived from the secret. */
  cashuProof: {
    id: CashuProofId,
    mint: NonEmptyString1000,
    unit: NonEmptyString100,
    keysetId: NonEmptyString100,
    amount: PositiveInt,
    secret: NonEmptyString1000,
    // The NUT-00 signature point `C`.
    c: NonEmptyString1000,
    // JSON of the NUT-12 DLEQ proof when the mint supplied one.
    dleq: nullOr(NonEmptyString1000),
    // "available" | "held" | "handedOut" | "externalized" | "spent"
    state: NonEmptyString100,
    operationId: nullOr(CashuOperationId),
  },
  /** Cashu scope: durable links between inputs and outputs (melts, topups, sends, ...). */
  cashuOperation: {
    id: CashuOperationId,
    // "melt" | "topup" | "autoswap" | "send" | "receive"
    kind: NonEmptyString100,
    status: NonEmptyString100,
    mint: NonEmptyString1000,
    unit: NonEmptyString100,
    keysetId: nullOr(NonEmptyString100),
    amount: PositiveInt,
    feeReserve: nullOr(NonNegativeInt),
    inputsTotal: nullOr(PositiveInt),
    quoteId: nullOr(NonEmptyString1000),
    invoice: nullOr(NonEmptyString),
    sourceMint: nullOr(NonEmptyString1000),
    // First deterministic output slot of the latest attempt.
    counter: nullOr(NonNegativeInt),
    locked: nullOr(SqliteBoolean),
    expiresAtSec: nullOr(PositiveInt),
    // Event time, separate from Evolu's updatedAt like `transaction`.
    createdAtSec: PositiveInt,
    tokenText: nullOr(NonEmptyString),
    error: nullOr(NonEmptyString1000),
  },
  /** Transactions scope: the payment history. Category derives from `method`. */
  transaction: {
    id: TransactionId,
    // Event time is intentionally stored separately from Evolu's updatedAt:
    // later row updates must not change when the payment actually happened.
    createdAtSec: PositiveInt,
    // "in" | "out"
    direction: NonEmptyString100,
    // "ok" | "pending" | "error" | "declined"
    status: NonEmptyString100,
    amount: nullOr(PositiveInt),
    fee: nullOr(PositiveInt),
    method: nullOr(NonEmptyString100),
    note: nullOr(NonEmptyString1000),
    detailsJson: nullOr(NonEmptyString),
    iconKind: nullOr(NonEmptyString100),
    contactId: nullOr(ContactId),
    mint: nullOr(NonEmptyString1000),
    unit: nullOr(NonEmptyString100),
    error: nullOr(NonEmptyString1000),
    pendingLabel: nullOr(NonEmptyString100),
  },
  /**
   * Transactions scope: a standing instruction to pay a contact on a
   * schedule. Each executed run is an ordinary `transaction` row that names
   * the payment in its details.
   */
  recurringPayment: {
    id: RecurringPaymentId,
    createdAtSec: PositiveInt,
    // The recipient; its npub or Lightning address decides the payment rail.
    contactId: ContactId,
    // In `unit`: sats for "sat", hundredths (cents, haléře) for a fiat code.
    amount: PositiveInt,
    // "sat" | "czk" | "eur" | "chf" | "usd"
    unit: NonEmptyString100,
    // "hour" | "day" | "week" | "month", multiplied by intervalCount.
    intervalUnit: NonEmptyString100,
    intervalCount: PositiveInt,
    // First due time; every later due time is anchor + n intervals evaluated
    // as a wall clock in `timeZone`, so a month-end anchor clamps per month.
    anchorAtSec: PositiveInt,
    timeZone: nullOr(NonEmptyString100),
    nextDueAtSec: PositiveInt,
    lastRunAtSec: nullOr(PositiveInt),
    // "running" | "paid" | "failed" | "skipped" | "interrupted"
    lastRunStatus: nullOr(NonEmptyString100),
    runCount: nullOr(NonNegativeInt),
    pausedAtSec: nullOr(PositiveInt),
    // Which device pays the upcoming due time: every online device may write
    // a claim, Evolu's last writer wins on all of them once synced.
    claimDeviceId: nullOr(NonEmptyString100),
    claimAtSec: nullOr(PositiveInt),
    claimDueAtSec: nullOr(PositiveInt),
  },
} satisfies EvoluSchema;

/** The column value types of an Evolu schema, the shape the shard store reads and writes. */
export type InferDbSchema<ES extends EvoluSchema> = {
  readonly [T in keyof ES]: {
    readonly [C in keyof ES[T]]: InferType<ES[T][C]>;
  };
};

export type LinkyDbSchema = InferDbSchema<typeof LinkySchema>;
export type LinkyTable = keyof LinkyDbSchema;

export type ShardPointerRow = Row<LinkyDbSchema["shardPointer"]>;
export type SettingRow = Row<LinkyDbSchema["setting"]>;
export type NostrIdentityRow = Row<LinkyDbSchema["nostrIdentity"]>;
export type ContactRow = Row<LinkyDbSchema["contact"]>;
export type ConversationRow = Row<LinkyDbSchema["conversation"]>;
export type MessageRow = Row<LinkyDbSchema["message"]>;
export type ReactionRow = Row<LinkyDbSchema["reaction"]>;
export type CashuProofRow = Row<LinkyDbSchema["cashuProof"]>;
export type CashuOperationRow = Row<LinkyDbSchema["cashuOperation"]>;
export type TransactionRow = Row<LinkyDbSchema["transaction"]>;
export type RecurringPaymentRow = Row<LinkyDbSchema["recurringPayment"]>;

const columnNames = <Table extends Record<string, unknown>>(
  table: Table,
): ReadonlyArray<keyof Table & string> =>
  Object.keys(table).filter((key): key is keyof Table & string => key in table);

/** Column names per table, for ports that need them (the in-memory one). */
export const linkyTableColumns: TableColumns<LinkyDbSchema> = {
  shardPointer: columnNames(LinkySchema.shardPointer),
  setting: columnNames(LinkySchema.setting),
  nostrIdentity: columnNames(LinkySchema.nostrIdentity),
  contact: columnNames(LinkySchema.contact),
  conversation: columnNames(LinkySchema.conversation),
  message: columnNames(LinkySchema.message),
  reaction: columnNames(LinkySchema.reaction),
  cashuProof: columnNames(LinkySchema.cashuProof),
  cashuOperation: columnNames(LinkySchema.cashuOperation),
  transaction: columnNames(LinkySchema.transaction),
  recurringPayment: columnNames(LinkySchema.recurringPayment),
};
