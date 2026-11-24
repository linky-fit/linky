import type { EvoluSchema, StandardSchemaV1 } from "@evolu/common";
import {
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
  DeviceId,
  HiddenListingId,
  ListingId,
  MessageId,
  NostrIdentityId,
  PinnedListingId,
  ReactionId,
  RecurringPaymentId,
  SettingId,
  ShardPointerId,
  OnchainTransferId,
  OnchainTransferMessageId,
  PeerListingsId,
  TransactionId,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
} from "@linky-fit/domain";

/** The columns a message has wherever it is stored. */
export const messageContentColumns = {
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
  // Set once either side deleted the message; the row stays as a placeholder
  // and `content` holds a stand-in instead of the text.
  deletedAtSec: nullOr(PositiveInt),
};

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
  /** Contacts scope: the profile, the user's overrides and the archive state. */
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
    archivedAtSec: nullOr(PositiveInt),
    // Written only by nightly builds before `hiddenListing`: JSON array of the
    // contact's listing ids the user hid, read once to move them there.
    // Removal gate in app/migrations/AGENTS.md.
    hiddenListingIdsJson: nullOr(NonEmptyString),
  },
  /**
   * Contacts scope: one thing the user offers to, or wants from, the
   * contacts who saved them back; what the app publishes as listings.
   */
  listing: {
    id: ListingId,
    createdAtSec: PositiveInt,
    // "offer" | "want"
    side: NonEmptyString100,
    title: NonEmptyString1000,
    // Decimal text as typed, up to two fraction digits, in `currency`.
    amount: NonEmptyString100,
    // ISO 4217 code, or "SAT" for whole sats.
    currency: NonEmptyString100,
    // What the amount buys, in the user's words ("za hodinu").
    unit: NonEmptyString100,
    // 1 when a zero `amount` means the price is to be agreed rather than free.
    priceByAgreement: nullOr(SqliteBoolean),
    // More about the listing, line breaks kept; validated by the consumer.
    description: nullOr(NonEmptyString1000),
    // JSON of linkstr's `PrivateImage`; validated by the consumer.
    image: nullOr(NonEmptyString),
    // Who sees the listing, JSON validated by the consumer: null for the
    // contacts, {"kind":"network"} or {"kind":"group","group":"<groupName>"}.
    audience: nullOr(NonEmptyString1000),
    // When the user paused the listing, which keeps it unpublished until they
    // resume it; null while it is active. Older releases ignore the column.
    pausedAtSec: nullOr(PositiveInt),
  },
  /** Contacts scope: someone else's listing the user hid; a removed row shows it again. */
  hiddenListing: {
    // `hiddenListingIdFor(authorPubkey, listingId)`, so hiding on two devices lands on one row.
    id: HiddenListingId,
    // Hex pubkey (64 chars) of the listing's author, a contact or not.
    authorPubkey: NonEmptyString100,
    listingId: NonEmptyString1000,
  },
  /** Contacts scope: someone else's listing the user pinned to the top; a removed row unpins it. */
  pinnedListing: {
    // `pinnedListingIdFor(authorPubkey, listingId)`, so pinning on two devices lands on one row.
    id: PinnedListingId,
    // Hex pubkey (64 chars) of the listing's author, a contact or not.
    authorPubkey: NonEmptyString100,
    listingId: NonEmptyString1000,
  },
  /**
   * Peer listings scope: the newest listings document of someone who shares
   * one with the user, kept so every device shows it while relays do not.
   */
  peerListings: {
    // `peerListingsIdFor(readerPubkey, authorPubkey)`, so every device lands on one row.
    id: PeerListingsId,
    // Hex pubkey (64 chars) of the user's identity that read the document; another identity reads another one.
    readerPubkey: NonEmptyString100,
    // Hex pubkey (64 chars) of the document's author.
    authorPubkey: NonEmptyString100,
    // JSON of linkstr's `ListingsDocument` as the reader decoded it; validated by the consumer.
    document: NonEmptyString,
    // The `created_at` of the event that carried the document.
    publishedAtSec: PositiveInt,
  },
  /**
   * Contacts scope: the user's instruction to pay a contact on a schedule.
   * Each executed run is an ordinary `transaction` row that names the
   * payment in its details.
   */
  recurringPayment: {
    id: RecurringPaymentId,
    createdAtSec: PositiveInt,
    contactId: ContactId,
    // Every run is paid from this mint; fixed at creation.
    mintUrl: NonEmptyString1000,
    // "cashu" | "lightning": how every run reaches the contact; fixed at creation.
    rail: NonEmptyString100,
    // In `unit`: sats for "sat", hundredths (cents, haléře) for a fiat code.
    amount: PositiveInt,
    // "sat" | "czk" | "eur" | "chf" | "usd" | "brl"
    unit: NonEmptyString100,
    // Carried by every run as its token memo or LUD-12 comment; editable.
    note: nullOr(NonEmptyString1000),
    // "hour" | "day" | "week" | "month", multiplied by intervalCount.
    intervalUnit: NonEmptyString100,
    intervalCount: PositiveInt,
    // First due time; every later due time is anchor + n intervals evaluated
    // as a wall clock in `timeZone`, so a month-end anchor clamps per month.
    anchorAtSec: PositiveInt,
    timeZone: nullOr(NonEmptyString100),
    // JSON {runCount, nextDueAtSec}: paid runs so far (the index of the next
    // run) and the pending due time, one column so sync never splits them.
    progress: NonEmptyString1000,
    lastRunAtSec: nullOr(PositiveInt),
    // "paid" | "failed" | "skipped"
    lastRunStatus: nullOr(NonEmptyString100),
    pausedAtSec: nullOr(PositiveInt),
  },
  /** Messages scope: one chat and its read cursors. */
  conversation: {
    id: ConversationId,
    // "direct" | "group"
    kind: NonEmptyString100,
    // Direct chats: the contact; `directConversationIdFor` derives the id from it.
    contactId: nullOr(ContactId),
    // Group chats (future): JSON array of participant pubkeys.
    participantsJson: nullOr(NonEmptyString),
    // Written only by older app versions; the archive state lives on `contact`.
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
    ...messageContentColumns,
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
  /** Unknown senders scope: a conversation with a peer who is not a contact. */
  unknownSenderMessage: {
    // `nostrMessageIdFor(rumorId)`, so the row keeps its id when it moves to a contact.
    id: MessageId,
    // Hex pubkey (64 chars) of the unknown sender, whichever way the message went.
    peerPubkey: NonEmptyString1000,
    ...messageContentColumns,
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
    // "melt" | "topup" | "autoswap" | "send" | "receive" | "deferredReceive" | "envelope"
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
  /** Onchain scope: one on-chain transfer, on the user's or the operator's account. */
  onchainTransfer: {
    id: OnchainTransferId,
    createdAtSec: PositiveInt,
    // "user" | "operator": which side of the transfer this account is.
    role: NonEmptyString100,
    // Hex pubkey of the other side: the operator for a user, the user for the operator.
    peerPubkey: NonEmptyString100,
    // "send" | "receive"
    direction: NonEmptyString100,
    // Sats the user gets; they send it plus the fee. Fixed at creation.
    amount: PositiveInt,
    // The fee the request was made at, in basis points.
    feeBasisPoints: NonNegativeInt,
    payoutAddress: nullOr(NonEmptyString1000),
    refundAddress: nullOr(NonEmptyString1000),
    // "1" when the user asked for a refund to the address they send from.
    refundToSender: nullOr(SqliteBoolean),
    // receive: the user's NUT-18 request the operator pays.
    userPaymentRequest: nullOr(NonEmptyString1000),
    // send: the operator's NUT-18 request the user pays.
    operatorPaymentRequest: nullOr(NonEmptyString1000),
    depositAddress: nullOr(NonEmptyString1000),
    // Operator only: BIP86 receive index of depositAddress.
    addressIndex: nullOr(NonNegativeInt),
    // Operator only: the wallet send carrying the transfer's Cashu, from before its message is queued until it left or was taken back.
    ecashSendId: nullOr(NonEmptyString100),
    // JSON of the latest OnchainTransferUpdate without paymentRequest, one column so sync never splits it.
    updateJson: nullOr(NonEmptyString1000),
    // User only.
    sentAtSec: nullOr(PositiveInt),
    cancelledAtSec: nullOr(PositiveInt),
    // User only, send: the payout txid Linky found on chain itself, for a transfer the operator closed without telling the user.
    payoutTxid: nullOr(NonEmptyString100),
    // Operator only: "completed" | "cancelled", the outcome the operator closed the transfer with by hand; the user is not told.
    closedByHand: nullOr(NonEmptyString100),
    // Operator only: "1" when the operator marked it a test transfer, which the console hides and leaves out of the stats.
    isTest: nullOr(SqliteBoolean),
  },
  /** Onchain scope, operator only: an on-chain transfer message a user sent, exactly as it arrived, the record to settle a dispute by. */
  onchainTransferMessage: {
    // `onchainTransferMessageIdFor(rumorId)`
    id: OnchainTransferMessageId,
    rumorId: NonEmptyString100,
    // Hex pubkey of the sender.
    peerPubkey: NonEmptyString100,
    // The transfer the message names; null when it does not decode.
    transferId: nullOr(OnchainTransferId),
    // The rumor content as received, decodable or not.
    content: NonEmptyString,
    sentAtSec: PositiveInt,
  },
  /**
   * Devices scope: one app on one device holding the recovery seed, which
   * Linky, Fazole and Finito each write and list. A removal is the row's
   * tombstone, which signs that app out once it sees it.
   */
  linkedDevice: {
    // Random, kept in the device's own storage until it signs out.
    id: DeviceId,
    // "linky" | "fazole" | "finito"; another value is an app this release does not know.
    app: NonEmptyString100,
    // Renamable; written by the device itself only while the row has none.
    name: NonEmptyString1000,
    // "mobile" | "tablet" | "desktop", as the device reported itself.
    deviceType: nullOr(NonEmptyString100),
    browserName: nullOr(NonEmptyString100),
    osName: nullOr(NonEmptyString100),
    // The device that removed this one, written with the tombstone, so the removed device can say who.
    removedBy: nullOr(DeviceId),
  },
} satisfies EvoluSchema;

/** The column value types of an Evolu schema, the shape the shard store reads and writes. */
export type InferDbSchema<ES extends EvoluSchema> = {
  readonly [T in keyof ES]: {
    readonly [C in keyof ES[T]]: StandardSchemaV1.InferOutput<ES[T][C]>;
  };
};

export type LinkyDbSchema = InferDbSchema<typeof LinkySchema>;
export type LinkyTable = keyof LinkyDbSchema;

export type CashuProofRow = Row<LinkyDbSchema["cashuProof"]>;
export type CashuOperationRow = Row<LinkyDbSchema["cashuOperation"]>;

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
  unknownSenderMessage: columnNames(LinkySchema.unknownSenderMessage),
  cashuProof: columnNames(LinkySchema.cashuProof),
  cashuOperation: columnNames(LinkySchema.cashuOperation),
  transaction: columnNames(LinkySchema.transaction),
  recurringPayment: columnNames(LinkySchema.recurringPayment),
  listing: columnNames(LinkySchema.listing),
  hiddenListing: columnNames(LinkySchema.hiddenListing),
  pinnedListing: columnNames(LinkySchema.pinnedListing),
  peerListings: columnNames(LinkySchema.peerListings),
  onchainTransfer: columnNames(LinkySchema.onchainTransfer),
  onchainTransferMessage: columnNames(LinkySchema.onchainTransferMessage),
  linkedDevice: columnNames(LinkySchema.linkedDevice),
};
