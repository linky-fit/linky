import { createIdFromString, directConversationIdFor } from "@linky-fit/domain";
import { Pubkey, type ClientId, type RumorId } from "@linky-fit/linkstr";
import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  nostrMessageIdFor,
  PositiveInt,
  type ConversationsRepository,
  type MessageRow,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { Chat, ChatMessage, ChatMessageStatus } from "../domain/chat";

const isPubkey = Schema.is(Pubkey);

// Users are no contacts of the operator's; the id only anchors their direct conversation.
const contactIdFor = (peer: Pubkey) =>
  createIdFromString<"Contact">(`onchain-operator/user/${peer}`);

const conversationIdFor = (peer: Pubkey) =>
  directConversationIdFor(contactIdFor(peer));

/** A chat message as it travelled over Nostr. */
export interface ChatMessageRecord {
  readonly rumorId: RumorId;
  /** The user the chat is with. */
  readonly peer: Pubkey;
  readonly direction: "in" | "out";
  readonly text: string;
  readonly createdAtSec: number;
  /** Who wrote it: the user for `in`, the operator for `out`. */
  readonly author: Pubkey;
  readonly status: ChatMessageStatus;
  readonly clientId: ClientId | null;
}

const statusOf = (row: MessageRow): ChatMessageStatus =>
  row.status === "pending"
    ? "pending"
    : row.status === "failed"
      ? "failed"
      : "sent";

const toChatMessage = (row: MessageRow): ChatMessage | null => {
  const direction =
    row.direction === "in" ? "in" : row.direction === "out" ? "out" : null;
  return direction !== null && row.content !== null && row.createdAtSec !== null
    ? {
        id: row.id,
        direction,
        text: row.content,
        createdAtSec: row.createdAtSec,
        status: statusOf(row),
      }
    : null;
};

/**
 * The chat with every user in `peers` and every user who wrote, each with
 * its messages oldest first.
 */
export const readChats = (
  conversations: ConversationsRepository,
  peers: readonly Pubkey[],
): Effect.Effect<readonly Chat[]> =>
  Effect.map(
    Effect.all([
      conversations.messages.all,
      conversations.all,
      conversations.visibleSinceSec,
    ]),
    ([rows, conversationRows, visibleSinceSec]) => {
      const writers = rows.flatMap((row) =>
        row.direction === "in" && isPubkey(row.pubkey) ? [row.pubkey] : [],
      );
      return [...new Set([...peers, ...writers])].map((peer) => {
        const id = conversationIdFor(peer);
        // Nostr times are whole seconds; the row's own millisecond time orders a burst.
        const messages = rows
          .filter((row) => row.conversationId === id)
          .sort(
            (a, b) =>
              (a.createdAtSec ?? 0) - (b.createdAtSec ?? 0) ||
              a.createdAt.localeCompare(b.createdAt),
          )
          .flatMap((row) => toChatMessage(row) ?? []);
        const seenSec = Math.max(
          conversationRows.find((row) => row.id === id)?.lastSeenAtSec ?? 0,
          visibleSinceSec ?? 0,
        );
        return {
          peer,
          messages,
          unread: messages.some(
            (message) =>
              message.direction === "in" && message.createdAtSec > seenSec,
          ),
        };
      });
    },
  );

/**
 * Stores a message under its rumor id, so a replayed inbox, an own echo and
 * another device storing the same message all land on one row. Returns
 * whether it wrote; an existing row is left as it is.
 */
export const storeChatMessage = (
  conversations: ConversationsRepository,
  message: ChatMessageRecord,
): Effect.Effect<boolean, ShardDbError> =>
  Effect.flatMap(conversations.ensureDirect(contactIdFor(message.peer)), () =>
    conversations.messages.insertIfAbsent({
      id: nostrMessageIdFor(message.rumorId),
      conversationId: conversationIdFor(message.peer),
      direction: NonEmptyString100.orThrow(message.direction),
      content: NonEmptyString.orThrow(message.text),
      wrapId: NonEmptyString1000.orThrow(`pending:${message.rumorId}`),
      rumorId: NonEmptyString1000.orThrow(message.rumorId),
      pubkey: NonEmptyString1000.orThrow(message.author),
      createdAtSec: PositiveInt.orThrow(message.createdAtSec),
      status: NonEmptyString100.orThrow(message.status),
      ...(message.clientId === null
        ? {}
        : { clientId: NonEmptyString1000.orThrow(message.clientId) }),
    }),
  );

/** Moves an own message on from `pending`; a sent message stays sent. */
export const setChatMessageStatus = (
  conversations: ConversationsRepository,
  match: { readonly rumorId: RumorId } | { readonly clientId: ClientId },
  status: ChatMessageStatus,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(conversations.messages.all, (rows) => {
    const wanted: string = "rumorId" in match ? match.rumorId : match.clientId;
    const row = rows.find(
      (candidate) =>
        ("rumorId" in match ? candidate.rumorId : candidate.clientId) ===
        wanted,
    );
    return row === undefined || row.status === status || row.status === "sent"
      ? Effect.void
      : conversations.messages
          .update(row.id, { status: NonEmptyString100.orThrow(status) })
          .pipe(Effect.catchTag("RowNotFound", () => Effect.void));
  });

/** Marks the user's messages up to `atSec` read. */
export const markChatSeen = (
  conversations: ConversationsRepository,
  peer: Pubkey,
  atSec: number,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(conversations.ensureDirect(contactIdFor(peer)), () =>
    conversations
      .markSeen(conversationIdFor(peer), PositiveInt.orThrow(atSec))
      .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
  );
