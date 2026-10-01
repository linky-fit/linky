import { NonEmptyString100, PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { OwnerId } from "@evolu/common";
import type { RowNotFound, ShardDbError } from "../core";
import {
  directConversationIdFor,
  type ContactId,
  type ConversationId,
} from "@linky-fit/domain";
import type {
  ConversationRow,
  LinkyDbSchema,
  MessageRow,
  ReactionRow,
} from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

export interface PeerSeenWindow {
  readonly sinceSec: PositiveInt | null;
  readonly atSec: PositiveInt;
}

export interface ConversationsRepository extends TableRepository<
  LinkyDbSchema["conversation"]
> {
  readonly messages: TableRepository<LinkyDbSchema["message"]>;
  readonly reactions: TableRepository<LinkyDbSchema["reaction"]>;
  /** The direct chat with a contact, created on first use; the id is derived from the contact id. */
  readonly ensureDirect: (
    contactId: ContactId,
  ) => Effect.Effect<ConversationRow, ShardDbError>;
  readonly forContact: (
    contactId: ContactId,
  ) => Effect.Effect<ConversationRow | null>;
  readonly messagesIn: (
    conversationId: ConversationId,
  ) => Effect.Effect<ReadonlyArray<MessageRow>>;
  readonly reactionsIn: (
    conversationId: ConversationId,
  ) => Effect.Effect<ReadonlyArray<ReactionRow>>;
  /**
   * When the oldest messages shard this device reads began (its earliest
   * row), or null when the device reads the scope from its first shard. Read
   * cursors written before it may sit in a forgotten shard.
   */
  readonly visibleSinceSec: Effect.Effect<number | null>;
  /** Tombstoned reaction copies in the visible shards, so a removed reaction's wrap is still known. */
  readonly removedReactions: Effect.Effect<ReadonlyArray<ReactionRow>>;
  /** Moves the read cursor forward; never backwards. */
  readonly markSeen: (
    conversationId: ConversationId,
    atSec: PositiveInt,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly setPeerSeen: (
    conversationId: ConversationId,
    window: PeerSeenWindow,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

const DIRECT = NonEmptyString100.orThrow("direct");

/** Chats with their cursors, plus the messages and reactions in them. */
export const makeConversationsRepository = (
  store: LinkyStore,
): ConversationsRepository => {
  const conversations = tableRepository(store, "messages", "conversation");
  const messages = tableRepository(store, "messages", "message");
  const reactions = tableRepository(store, "messages", "reaction");

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
              kind: DIRECT,
              contactId,
              ...(sinceSec === null
                ? {}
                : { lastSeenAtSec: PositiveInt.orThrow(sinceSec) }),
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
    reactionsIn: (conversationId) =>
      Effect.map(reactions.all, (rows) =>
        rows.filter((row) => row.conversationId === conversationId),
      ),
    visibleSinceSec,
    removedReactions: Effect.map(store.copies("messages", "reaction"), (rows) =>
      rows.filter((row) => row.isDeleted === 1),
    ),
    markSeen: (conversationId, atSec) =>
      Effect.flatMap(conversations.byId(conversationId), (row) =>
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
