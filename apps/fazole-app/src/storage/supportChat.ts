import type { ClientId, Pubkey, RumorId } from "@linky-fit/linkstr";
import {
  createIdFromString,
  directConversationIdFor,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  nostrMessageIdFor,
  PositiveInt,
  type ConversationsRepository,
  type MessageRow,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import type {
  SupportChat,
  SupportMessage,
  SupportMessageStatus,
} from "../domain";

// Support is no contact of the merchant's; the id only anchors its direct conversation.
const supportContactId = createIdFromString<"Contact">("fazole/support");
const supportConversationId = directConversationIdFor(supportContactId);

/** A message of the support chat as it travelled over Nostr. */
export interface SupportMessageRecord {
  readonly rumorId: RumorId;
  readonly direction: "in" | "out";
  readonly text: string;
  readonly createdAtSec: number;
  /** Who wrote it: support for `in`, the merchant for `out`. */
  readonly author: Pubkey;
  readonly status: SupportMessageStatus;
  readonly clientId: ClientId | null;
}

const directionOf = (row: MessageRow) =>
  row.direction === "in" ? "in" : row.direction === "out" ? "out" : null;

const statusOf = (row: MessageRow): SupportMessageStatus =>
  row.status === "pending"
    ? "pending"
    : row.status === "failed"
      ? "failed"
      : "sent";

const toSupportMessage = (row: MessageRow): SupportMessage | null => {
  const direction = directionOf(row);
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

export const readSupportChat = (
  conversations: ConversationsRepository,
): Effect.Effect<SupportChat> =>
  Effect.map(
    Effect.all([
      conversations.messagesIn(supportConversationId),
      conversations.byId(supportConversationId),
      conversations.visibleSinceSec,
    ]),
    ([rows, conversation, visibleSinceSec]) => {
      // Nostr times are whole seconds; the row's own millisecond time orders a burst.
      const messages = [...rows]
        .sort(
          (a, b) =>
            (a.createdAtSec ?? 0) - (b.createdAtSec ?? 0) ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .flatMap((row) => toSupportMessage(row) ?? []);
      const seenSec = Math.max(
        conversation?.lastSeenAtSec ?? 0,
        visibleSinceSec ?? 0,
      );
      return {
        messages,
        unread: messages.some(
          (message) =>
            message.direction === "in" && message.createdAtSec > seenSec,
        ),
      };
    },
  );

/**
 * Stores a message under its rumor id, so a replayed inbox, an own echo and
 * another device storing the same message all land on one row. Returns
 * whether it wrote; an existing row is left as it is.
 */
export const storeSupportMessage = (
  conversations: ConversationsRepository,
  message: SupportMessageRecord,
): Effect.Effect<boolean, ShardDbError> =>
  Effect.flatMap(conversations.ensureDirect(supportContactId), () =>
    conversations.messages.insertIfAbsent({
      id: nostrMessageIdFor(message.rumorId),
      conversationId: supportConversationId,
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
export const setSupportMessageStatus = (
  conversations: ConversationsRepository,
  match: { readonly rumorId: RumorId } | { readonly clientId: ClientId },
  status: SupportMessageStatus,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(conversations.messagesIn(supportConversationId), (rows) => {
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

/** Marks support's messages up to `atSec` read. */
export const markSupportChatSeen = (
  conversations: ConversationsRepository,
  atSec: number,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(conversations.ensureDirect(supportContactId), () =>
    conversations
      .markSeen(supportConversationId, PositiveInt.orThrow(atSec))
      .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
  );
