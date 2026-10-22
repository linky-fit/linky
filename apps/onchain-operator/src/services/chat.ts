import {
  ClientId,
  MessageText,
  type Pubkey,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import { createId, type ConversationsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import {
  markChatSeen,
  setChatMessageStatus,
  storeChatMessage,
  type ChatMessageRecord,
} from "../storage/chat";
import type { Nostr } from "./nostr";
import { exclusive } from "./serial";

const CHAT_REF = "chat:";

/** The text or token a chat message between the operator and a user carries; `null` for anything else. */
export const chatMessageOf = (
  event: WrapInboxEvent,
  operator: Pubkey,
): ChatMessageRecord | null => {
  if (
    (event._tag !== "ChatMessageReceived" &&
      event._tag !== "OwnChatMessageConfirmed") ||
    event.editOf !== null
  ) {
    return null;
  }
  const text =
    event.body._tag === "TextBody"
      ? event.body.text
      : event.body._tag === "TokenBody"
        ? event.body.token
        : null;
  if (text === null) return null;
  const incoming = event._tag === "ChatMessageReceived";
  return {
    rumorId: event.messageId,
    peer: incoming ? event.from : event.to,
    direction: incoming ? "in" : "out",
    text,
    createdAtSec: event.sentAt,
    author: incoming ? event.from : operator,
    status: "sent",
    clientId: event.clientId,
  };
};

/** NIP-17 chats with users, one per user, kept in the synced messages scope. */
export interface Chats {
  /** Queues the text to the user and stores it as pending; rejects when the outbox did not take it. */
  readonly send: (to: Pubkey, text: string) => Promise<void>;
  /** The operator read the user's messages up to `atSec`. */
  readonly markSeen: (peer: Pubkey, atSec: number) => Promise<void>;
}

export const createChats = ({
  conversations,
  nostr,
  whenHydrated,
  onNewIncoming,
}: {
  readonly conversations: ConversationsRepository;
  readonly nostr: Nostr;
  readonly whenHydrated: () => Promise<void>;
  /** A message from someone else, the first time it is stored. */
  readonly onNewIncoming?: (message: ChatMessageRecord) => void;
}): Chats => {
  // A send stores its row before its outbox result or echo can update it.
  const serially = exclusive();
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

  nostr.onInboxEvent(async (event) => {
    const message = chatMessageOf(event, nostr.pubkey);
    if (message === null) return;
    await whenHydrated();
    await serially(async () => {
      const stored = await run(storeChatMessage(conversations, message));
      if (stored && message.direction === "in") onNewIncoming?.(message);
      if (!stored && message.direction === "out") {
        await run(
          setChatMessageStatus(
            conversations,
            { rumorId: message.rumorId },
            "sent",
          ),
        );
      }
    });
  });

  nostr.onOutboxResult(CHAT_REF, async (result) => {
    await whenHydrated();
    await serially(() =>
      run(
        result._tag === "OutboxJobSucceeded"
          ? setChatMessageStatus(
              conversations,
              { rumorId: result.receipt.rumorId },
              "sent",
            )
          : setChatMessageStatus(
              conversations,
              { clientId: ClientId.make(result.ref.slice(CHAT_REF.length)) },
              "failed",
            ),
      ),
    );
  });

  return {
    send: (to, text) =>
      serially(async () => {
        const content = MessageText.make(text.trim());
        const clientId = ClientId.make(createId());
        const receipt = await nostr.sendText(
          to,
          content,
          clientId,
          `${CHAT_REF}${clientId}`,
        );
        // The message is on its way; should this write fail, its own echo stores it.
        await run(
          storeChatMessage(conversations, {
            rumorId: receipt.rumorId,
            peer: to,
            direction: "out",
            text: content,
            createdAtSec: receipt.sentAt,
            author: nostr.pubkey,
            status: "pending",
            clientId,
          }),
        ).catch((error: unknown) =>
          console.warn("[onchain-operator] chat message not stored", error),
        );
      }),
    markSeen: (peer, atSec) =>
      serially(() => run(markChatSeen(conversations, peer, atSec))),
  };
};
