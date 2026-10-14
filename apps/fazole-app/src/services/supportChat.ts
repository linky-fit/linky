import {
  ClientId,
  decodeNpub,
  MessageText,
  type Pubkey,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import { createId, type ConversationsRepository } from "@linky-fit/linksync";
import type { LiveSource } from "@linky-fit/linksync/react";
import { Effect } from "effect";
import type { SupportChat as SupportChatView } from "../domain";
import {
  markSupportChatSeen,
  readSupportChat,
  setSupportMessageStatus,
  storeSupportMessage,
  type SupportMessageRecord,
} from "../storage/supportChat";
import type { Nostr } from "./nostr";
import { exclusive } from "./serial";

const SUPPORT_NPUB =
  "npub1wfxgaznkc7xz9t7zk6mwrn665twz6ghqdgmx0l3lumus2hhjs0yquvld92";

const decodeSupportPubkey = (): Pubkey => {
  const pubkey = decodeNpub(SUPPORT_NPUB);
  if (pubkey === null) throw new Error("the support npub does not decode");
  return pubkey;
};

/** Fazole support on Nostr: the merchant's chat goes to this key only. */
export const supportPubkey = decodeSupportPubkey();

const SUPPORT_REF = "support:";

/** The text message an inbox event carries between the merchant and `support`, or `null` for anything else. */
export const supportMessageOf = (
  event: WrapInboxEvent,
  merchant: Pubkey,
  support: Pubkey,
): SupportMessageRecord | null => {
  if (
    (event._tag !== "ChatMessageReceived" &&
      event._tag !== "OwnChatMessageConfirmed") ||
    event.editOf !== null ||
    event.body._tag !== "TextBody"
  ) {
    return null;
  }
  const incoming = event._tag === "ChatMessageReceived";
  if ((incoming ? event.from : event.to) !== support) return null;
  return {
    rumorId: event.messageId,
    direction: incoming ? "in" : "out",
    text: event.body.text,
    createdAtSec: event.sentAt,
    author: incoming ? support : merchant,
    status: "sent",
    clientId: event.clientId,
  };
};

/** The merchant's chat with Fazole support: NIP-17 texts, kept in the synced messages scope. */
export interface SupportChat {
  /** Queues the text to support and stores it as pending; rejects when the outbox did not take it. */
  readonly send: (text: string) => Promise<void>;
  /** The merchant read support's messages up to `atSec`. */
  readonly markSeen: (atSec: number) => Promise<void>;
  readonly live: LiveSource<SupportChatView>;
}

export const createSupportChat = ({
  conversations,
  nostr,
  whenHydrated,
}: {
  readonly conversations: ConversationsRepository;
  readonly nostr: Nostr;
  readonly whenHydrated: () => Promise<void>;
}): SupportChat => {
  // A send stores its row before its outbox result or echo can update it.
  const serially = exclusive();
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

  nostr.onInboxEvent(async (event) => {
    const message = supportMessageOf(event, nostr.pubkey, supportPubkey);
    if (message === null) return;
    await whenHydrated();
    await serially(async () => {
      const stored = await run(storeSupportMessage(conversations, message));
      if (!stored && message.direction === "out") {
        await run(
          setSupportMessageStatus(
            conversations,
            { rumorId: message.rumorId },
            "sent",
          ),
        );
      }
    });
  });

  nostr.onOutboxResult(SUPPORT_REF, async (result) => {
    await whenHydrated();
    await serially(() =>
      run(
        result._tag === "OutboxJobSucceeded"
          ? setSupportMessageStatus(
              conversations,
              { rumorId: result.receipt.rumorId },
              "sent",
            )
          : setSupportMessageStatus(
              conversations,
              { clientId: ClientId.make(result.ref.slice(SUPPORT_REF.length)) },
              "failed",
            ),
      ),
    );
  });

  return {
    send: (text) =>
      serially(async () => {
        const content = MessageText.make(text.trim());
        const clientId = ClientId.make(createId());
        const receipt = await nostr.sendText(
          supportPubkey,
          content,
          clientId,
          `${SUPPORT_REF}${clientId}`,
        );
        // The message is on its way; should this write fail, its own echo stores it.
        await run(
          storeSupportMessage(conversations, {
            rumorId: receipt.rumorId,
            direction: "out",
            text: content,
            createdAtSec: receipt.sentAt,
            author: nostr.pubkey,
            status: "pending",
            clientId,
          }),
        ).catch((error: unknown) =>
          console.warn("[fazole] support message not stored", error),
        );
      }),
    markSeen: (atSec) =>
      serially(() => run(markSupportChatSeen(conversations, atSec))),
    live: {
      all: readSupportChat(conversations),
      subscribe: conversations.subscribe,
    },
  };
};
