import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import type { ShardDbError, WriteRow } from "../core";
import type { ContactId, ConversationId } from "../model/ids";
import {
  messageContentColumns,
  type LinkyDbSchema,
  type UnknownSenderMessageRow,
} from "../model/schema";
import type { LinkyStore } from "../model/store";
import { makeConversationsRepository } from "./conversations";
import { tableRepository, type TableRepository } from "./tableRepository";

export interface UnknownSendersRepository extends TableRepository<
  LinkyDbSchema["unknownSenderMessage"]
> {
  /**
   * Moves the sender's messages into the contact's direct conversation, each
   * under its own id, and removes them here. Safe to repeat and to run on two
   * devices at once. Returns how many messages left this scope.
   */
  readonly moveToContact: (
    peerPubkey: Pubkey,
    contactId: ContactId,
  ) => Effect.Effect<number, ShardDbError>;
  /** Removes every message of the sender; returns how many. */
  readonly removeSender: (
    peerPubkey: Pubkey,
  ) => Effect.Effect<number, ShardDbError>;
}

type ContentColumn = keyof typeof messageContentColumns;

const isContentColumn = (column: string): column is ContentColumn =>
  column in messageContentColumns;

/** The row's message content columns that hold a value: an insert omits empty optional ones. */
const contentOf = (row: UnknownSenderMessageRow) => {
  const content: {
    -readonly [K in ContentColumn]?: UnknownSenderMessageRow[K];
  } = {};
  const copy = <K extends ContentColumn>(column: K) => {
    const value = row[column];
    if (value !== null) content[column] = value;
  };
  Object.keys(messageContentColumns).filter(isContentColumn).forEach(copy);
  return content;
};

/** The row as a message of the conversation; null while sync has not delivered its required columns. */
const toMessageRow = (
  row: UnknownSenderMessageRow,
  conversationId: ConversationId,
): WriteRow<LinkyDbSchema["message"]> | null => {
  const { direction, content, wrapId, createdAtSec } = row;
  if (
    direction === null ||
    content === null ||
    wrapId === null ||
    createdAtSec === null
  )
    return null;
  return {
    ...contentOf(row),
    id: row.id,
    conversationId,
    direction,
    content,
    wrapId,
    createdAtSec,
  };
};

/** Conversations with peers who are not contacts, kept apart from `messages` and forgotten sooner. */
export const makeUnknownSendersRepository = (
  store: LinkyStore,
): UnknownSendersRepository => {
  const messages = tableRepository(
    store,
    "unknownSenders",
    "unknownSenderMessage",
  );
  const conversations = makeConversationsRepository(store);

  const messagesFrom = (peerPubkey: Pubkey) => {
    const sender: string = peerPubkey;
    return Effect.map(messages.all, (rows) =>
      rows.filter((row) => row.peerPubkey === sender),
    );
  };

  // Another device may have removed the row since it was read; it is gone either way.
  const removeQuietly = (row: UnknownSenderMessageRow) =>
    messages
      .remove(row.id)
      .pipe(Effect.catchTag("RowNotFound", () => Effect.void));

  return {
    ...messages,
    moveToContact: (peerPubkey, contactId) =>
      Effect.gen(function* () {
        const rows = yield* messagesFrom(peerPubkey);
        if (rows.length === 0) return 0;
        const { id: conversationId } =
          yield* conversations.ensureDirect(contactId);
        let moved = 0;
        for (const row of rows) {
          const message = toMessageRow(row, conversationId);
          if (message === null) continue;
          yield* conversations.messages.insertIfAbsent(message);
          yield* removeQuietly(row);
          moved += 1;
        }
        return moved;
      }),
    removeSender: (peerPubkey) =>
      Effect.flatMap(messagesFrom(peerPubkey), (rows) =>
        Effect.as(
          Effect.forEach(rows, removeQuietly, { discard: true }),
          rows.length,
        ),
      ),
  };
};
