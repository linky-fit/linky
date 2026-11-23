import { PositiveInt, type OwnerId } from "@evolu/common";
import {
  directConversationIdFor,
  type ContactId,
  type ConversationId,
} from "@linky-fit/domain";
import { Effect } from "effect";
import { ShardDbError, type RowNotFound } from "../core";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  toDomainRow,
  type DomainPatch,
  type DomainRow,
  type DomainTableRepository,
  type DomainWriteRow,
} from "./domainRepository";

export type ConversationRecord = DomainRow<LinkyDbSchema["conversation"]>;
export type MessageRecord = DomainRow<LinkyDbSchema["message"]>;
export type MessageInsert = DomainWriteRow<LinkyDbSchema["message"]>;
export type MessagePatch = DomainPatch<LinkyDbSchema["message"]>;
export type ReactionRecord = DomainRow<LinkyDbSchema["reaction"]>;
export type ReactionInsert = DomainWriteRow<LinkyDbSchema["reaction"]>;
export type ReactionPatch = DomainPatch<LinkyDbSchema["reaction"]>;

export interface PeerSeenWindow {
  readonly sinceSec: number | null;
  readonly atSec: number;
}

export interface ConversationsRepository extends DomainTableRepository<
  LinkyDbSchema["conversation"]
> {
  readonly messages: DomainTableRepository<LinkyDbSchema["message"]>;
  readonly reactions: DomainTableRepository<LinkyDbSchema["reaction"]>;
  /** The direct chat with a contact, created on first use; the id is derived from the contact id. */
  readonly ensureDirect: (
    contactId: ContactId,
  ) => Effect.Effect<ConversationRecord, ShardDbError>;
  readonly forContact: (
    contactId: ContactId,
  ) => Effect.Effect<ConversationRecord | null>;
  readonly messagesIn: (
    conversationId: ConversationId,
  ) => Effect.Effect<ReadonlyArray<MessageRecord>>;
  /**
   * When the oldest messages shard this device reads began (its earliest
   * row), or null when the device reads the scope from its first shard. Read
   * cursors written before it may sit in a forgotten shard.
   */
  readonly visibleSinceSec: Effect.Effect<number | null>;
  /** Tombstoned reaction copies in the visible shards, so a removed reaction's wrap is still known. */
  readonly removedReactions: Effect.Effect<ReadonlyArray<ReactionRecord>>;
  /** Moves the read cursor forward; never backwards. */
  readonly markSeen: (
    conversationId: ConversationId,
    atSec: number,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly setPeerSeen: (
    conversationId: ConversationId,
    window: PeerSeenWindow,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

/** Chats with their cursors, plus the messages and reactions in them. */
export const makeConversationsRepository = (
  store: LinkyStore,
): ConversationsRepository => {
  const conversations = domainTableRepository(
    store,
    "messages",
    "conversation",
  );
  const messages = domainTableRepository(store, "messages", "message");
  const reactions = domainTableRepository(store, "messages", "reaction");

  const forContact = (contactId: ContactId) =>
    conversations.byId(directConversationIdFor(contactId));

  const earliestRowSec = (ownerId: OwnerId) =>
    Effect.map(
      Effect.all([
        store.copies("messages", "conversation"),
        store.copies("messages", "message"),
        store.copies("messages", "reaction"),
      ]),
      (copies) => {
        const startedAtMs = copies
          .flat()
          .filter((row) => row.ownerId === ownerId)
          .reduce((earliest, row) => {
            const atMs = Date.parse(row.createdAt);
            return atMs < earliest ? atMs : earliest;
          }, Infinity);
        return Number.isFinite(startedAtMs)
          ? Math.floor(startedAtMs / 1000)
          : null;
      },
    );

  // Once hydrated, the oldest visible shard holds every row it will get before this device writes.
  const startedSecByOwner = new Map<OwnerId, number>();
  const visibleSinceSec: Effect.Effect<number | null> = Effect.gen(
    function* () {
      const [oldest] = yield* store.visibleShards("messages");
      if (oldest === undefined || oldest.index === 0) return null;
      const known = startedSecByOwner.get(oldest.owner.id);
      if (known !== undefined) return known;
      const startedSec = yield* earliestRowSec(oldest.owner.id);
      if (startedSec !== null && (yield* store.hydrated))
        startedSecByOwner.set(oldest.owner.id, startedSec);
      return startedSec;
    },
  );

  return {
    ...conversations,
    messages,
    reactions,
    forContact,
    ensureDirect: (contactId) =>
      Effect.flatMap(forContact(contactId), (existing) => {
        if (existing !== null) return Effect.succeed(existing);
        const id = directConversationIdFor(contactId);
        return visibleSinceSec.pipe(
          Effect.flatMap((sinceSec) =>
            conversations.insert({
              id,
              kind: "direct",
              contactId,
              ...(sinceSec === null ? {} : { lastSeenAtSec: sinceSec }),
            }),
          ),
          Effect.flatMap(() => conversations.byId(id)),
          Effect.flatMap((created) =>
            created === null
              ? Effect.die(new Error("conversation vanished after insert"))
              : Effect.succeed(created),
          ),
        );
      }),
    messagesIn: (conversationId) =>
      Effect.map(messages.all, (rows) =>
        rows.filter((row) => row.conversationId === conversationId),
      ),
    visibleSinceSec,
    removedReactions: Effect.map(
      store.copies("messages", "reaction"),
      (rows) => {
        const seen = new Set<string>();
        const removed = [];
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          if (row.isDeleted === 1) removed.push(toDomainRow("reaction", row));
        }
        return removed;
      },
    ),
    markSeen: (conversationId, atSec) =>
      !PositiveInt.is(atSec)
        ? Effect.fail(
            new ShardDbError({
              table: "conversation",
              message: "invalid lastSeenAtSec",
            }),
          )
        : Effect.flatMap(conversations.byId(conversationId), (row) =>
            row !== null && (row.lastSeenAtSec ?? 0) >= atSec
              ? Effect.void
              : conversations.update(conversationId, { lastSeenAtSec: atSec }),
          ),
    setPeerSeen: (conversationId, window) =>
      conversations.update(conversationId, {
        peerSeenSinceSec: window.sinceSec,
        peerSeenAtSec: window.atSec,
      }),
  };
};
