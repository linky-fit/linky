import type { PositiveInt } from "@evolu/common";
import { NonEmptyString100 } from "@evolu/common";
import { Effect } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import {
  directConversationIdFor,
  type ContactId,
  type ConversationId,
} from "../model/ids";
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
  /** Moves the read cursor forward; never backwards. */
  readonly markSeen: (
    conversationId: ConversationId,
    atSec: PositiveInt,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly setPeerSeen: (
    conversationId: ConversationId,
    window: PeerSeenWindow,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly archive: (
    conversationId: ConversationId,
    atSec: PositiveInt,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly unarchive: (
    conversationId: ConversationId,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

const DIRECT = NonEmptyString100.orThrow("direct");

/** Chats with their cursors and archive state, plus the messages and reactions in them. */
export const makeConversationsRepository = (
  store: LinkyStore,
): ConversationsRepository => {
  const conversations = tableRepository(store, "messages", "conversation");
  const messages = tableRepository(store, "messages", "message");
  const reactions = tableRepository(store, "messages", "reaction");

  const forContact = (contactId: ContactId) =>
    conversations.byId(directConversationIdFor(contactId));

  return {
    ...conversations,
    messages,
    reactions,
    forContact,
    ensureDirect: (contactId) =>
      Effect.flatMap(forContact(contactId), (existing) => {
        if (existing !== null) return Effect.succeed(existing);
        const id = directConversationIdFor(contactId);
        return conversations.insert({ id, kind: DIRECT, contactId }).pipe(
          Effect.flatMap(() => conversations.byId(id)),
          Effect.flatMap((created) =>
            created === null
              ? Effect.dieMessage("conversation vanished after insert")
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
    archive: (conversationId, atSec) =>
      conversations.update(conversationId, { archivedAtSec: atSec }),
    unarchive: (conversationId) =>
      conversations.update(conversationId, { archivedAtSec: null }),
  };
};
