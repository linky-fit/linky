import * as Evolu from "@evolu/common";
import { kyselySql } from "@evolu/common";
import type { IndexesConfig } from "@evolu/common/local-first";
import {
  ContactId,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
} from "@linky-fit/domain";
import { LinkySchema } from "../model";

const CashuTokenId = Evolu.id("CashuToken");
export type CashuTokenId = typeof CashuTokenId.Output;

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
    direction: NonEmptyString100,
    // Decrypted plaintext message.
    content: NonEmptyString,
    // Incoming rows use the rumor id here as their de-duplication key.
    wrapId: NonEmptyString1000,
    // Edits keep the original message's rumor id so reactions and replies resolve.
    rumorId: Evolu.nullOr(NonEmptyString1000),
    // Sender pubkey hex (64 chars) of the inner message.
    // Can be null for local-only queued placeholders.
    pubkey: Evolu.nullOr(NonEmptyString1000),
    // created_at (seconds) from the inner event when available.
    createdAtSec: Evolu.PositiveInt,
    // Client-generated id for optimistic send/ack matching.
    clientId: Evolu.nullOr(NonEmptyString1000),
    // "sent" | "pending"
    status: Evolu.nullOr(NonEmptyString100),
    // "1" for local-only placeholders.
    localOnly: Evolu.nullOr(NonEmptyString100),
    // Reply metadata (NIP-10).
    replyToId: Evolu.nullOr(NonEmptyString1000),
    replyToContent: Evolu.nullOr(NonEmptyString),
    rootMessageId: Evolu.nullOr(NonEmptyString1000),
    // Edit metadata.
    editedAtSec: Evolu.nullOr(Evolu.PositiveInt),
    editedFromId: Evolu.nullOr(NonEmptyString1000),
    // "1" if the message content was edited.
    isEdited: Evolu.nullOr(NonEmptyString100),
    // First known message content before edits.
    originalContent: Evolu.nullOr(NonEmptyString),
  },
  nostrReaction: {
    id: NostrReactionId,
    // Target message rumor id.
    messageId: NonEmptyString1000,
    reactorPubkey: NonEmptyString1000,
    emoji: NonEmptyString100,
    createdAtSec: Evolu.PositiveInt,
    // Gift-wrapped event id carrying the reaction or delete.
    wrapId: NonEmptyString1000,
    // Client-generated id for optimistic send/ack matching.
    clientId: Evolu.nullOr(NonEmptyString1000),
    // "sent" | "pending"
    status: Evolu.nullOr(NonEmptyString100),
  },
  cashuToken: {
    id: CashuTokenId,
    // Most recent (accepted) token.
    token: NonEmptyString,
    // Token text the row was first created from — the row's stable identity
    // for dedup. Reads fall back to rawToken/token for legacy rows.
    originalTokenText: Evolu.nullOr(NonEmptyString),
    // Deprecated compatibility column. New rows use a deterministic id derived
    // from the original token and only store the latest spendable token here.
    rawToken: Evolu.nullOr(NonEmptyString),
    // Deprecated compatibility columns. New writes derive this metadata from
    // token; keep the columns while older clients/data still use them.
    mint: Evolu.nullOr(NonEmptyString1000),
    unit: Evolu.nullOr(NonEmptyString100),
    amount: Evolu.nullOr(Evolu.PositiveInt),
    // "pending" | "accepted" | "error"
    state: Evolu.nullOr(NonEmptyString100),
    error: Evolu.nullOr(NonEmptyString1000),
  },
  transaction: {
    ...LinkySchema.transaction,
    // Deprecated compatibility column. New writes derive category from method.
    category: Evolu.nullOr(NonEmptyString100),
    // Deprecated compatibility columns. New writes use method + status and
    // derive labels/icons in the transaction view.
    phase: Evolu.nullOr(NonEmptyString100),
  },
  ownerMeta: {
    id: OwnerMetaId,
    scope: NonEmptyString100,
    value: NonEmptyString1000,
  },
};

// Evolu 8 creates `evolu_<table>_id` on every table; only targeted query indexes belong here.
export const linkyIndexes: IndexesConfig = (create) => [
  create("cashuProofState").on("cashuProof").column("state"),
  create("cashuProofOperationId").on("cashuProof").column("operationId"),
  create("cashuProofKeysetCreatedSecond")
    .on("cashuProof")
    .column("keysetId")
    .expression(kyselySql`substr("createdAt", 1, 19)`)
    .column("mint"),
  create("historyTable").on("evolu_history").column("table"),
];
