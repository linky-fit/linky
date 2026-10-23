import type { MessageRow, ReactionRow } from "@linky-fit/linksync";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  keepUnchangedLists,
  keepUnchangedRows,
  sameItems,
} from "../../../utils/structuralSharing";
import { trimString } from "../../../utils/validation";
import { buildUnknownContactId } from "../../hooks/messages/contactIdentity";
import {
  dedupeChatMessages,
  dedupeNostrMessagesByPriority,
} from "../../hooks/messages/messageHelpers";
import {
  contactIdByConversationId,
  toLocalNostrMessage,
  toLocalNostrReaction,
} from "../../hooks/messages/messageRows";
import { storedReactionKey } from "../../hooks/messages/reactionInbox";
import { isIdentityChangeMessageContent } from "../../lib/identityChangeMessage";
import {
  isOnchainTransferPaymentContent,
  onchainOperator,
} from "../../lib/onchainOperator";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
} from "../../types/appTypes";
import {
  contactRowsAtom,
  conversationRowsAtom,
  liveRowsAtom,
} from "../contacts/readModel";
import { liveAtom } from "../session/live";
import {
  conversationsRepositoryAtom,
  unknownSendersRepositoryAtom,
} from "../session/store";

const NO_ROWS: ReadonlyArray<never> = [];
const NO_MESSAGES: LocalNostrMessage[] = [];

/** The contact ids the operator's chat is stored under: its saved contacts' and, before one is saved, the unknown sender's. */
export const onchainOperatorChatIds = (
  operator: typeof onchainOperator,
  contacts: ReadonlyArray<{
    readonly id: string;
    readonly npub: string | null;
  }>,
): ReadonlySet<string> => {
  if (operator === null) return new Set();
  const ids = new Set(
    contacts.flatMap((contact) =>
      normalizeNpubIdentifier(contact.npub ?? "") === operator.npub
        ? [contact.id]
        : [],
    ),
  );
  const unknownId = buildUnknownContactId(operator.pubkey);
  if (unknownId !== null) ids.add(unknownId);
  return ids;
};

/**
 * Whether a message shows in the chat: the Cashu of an on-chain transfer with
 * the operator shows on the transfer instead. Only what the chat displays is
 * filtered; the wallet still claims it from the unfiltered messages.
 */
export const isShownInChat =
  (operatorChatIds: ReadonlySet<string>) =>
  (message: Pick<LocalNostrMessage, "contactId" | "content">): boolean =>
    !operatorChatIds.has(message.contactId.trim()) ||
    !isOnchainTransferPaymentContent(message.content);

export const isShownInChatAtom = Atom.keepAlive(
  Atom.readable((get) =>
    isShownInChat(
      onchainOperatorChatIds(onchainOperator, get(contactRowsAtom)),
    ),
  ),
);

const messageRowsResultAtom = liveAtom(
  conversationsRepositoryAtom,
  (conversations) => conversations.messages,
);

/** The stored messages of saved contacts; null until the first read answers. */
export const messageRowsAtom = Atom.keepAlive(
  Atom.readable((get): ReadonlyArray<MessageRow> | null =>
    Option.getOrNull(AsyncResult.value(get(messageRowsResultAtom))),
  ),
);

const reactionRowsAtom = liveRowsAtom(
  liveAtom(
    conversationsRepositoryAtom,
    (conversations) => conversations.reactions,
  ),
);

const removedReactionRowsAtom = liveRowsAtom(
  liveAtom(conversationsRepositoryAtom, (conversations) => ({
    all: conversations.removedReactions,
    subscribe: conversations.reactions.subscribe,
  })),
);

const unknownSenderRowsAtom = liveRowsAtom(
  liveAtom(unknownSendersRepositoryAtom, (unknownSenders) => unknownSenders),
);

const visibleSinceSecResultAtom = liveAtom(
  conversationsRepositoryAtom,
  (conversations) => ({
    all: conversations.visibleSinceSec,
    subscribe: conversations.subscribe,
  }),
);

/** See `ConversationsRepository.visibleSinceSec`; null until read. */
export const messagesVisibleSinceSecAtom = Atom.keepAlive(
  Atom.readable((get) =>
    Option.getOrNull(AsyncResult.value(get(visibleSinceSecResultAtom))),
  ),
);

/** The messages of saved contacts, oldest first. */
export const contactMessagesAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const contactByConversation = contactIdByConversationId(
      get(conversationRowsAtom),
      get(contactRowsAtom),
    );
    const parsed: LocalNostrMessage[] = [];
    for (const row of get(messageRowsAtom) ?? NO_ROWS) {
      const normalized = toLocalNostrMessage(
        row,
        row.conversationId === null
          ? undefined
          : contactByConversation.get(row.conversationId),
      );
      if (normalized) parsed.push(normalized);
    }
    return dedupeNostrMessagesByPriority(parsed).sort(
      (a, b) => a.createdAtSec - b.createdAtSec,
    );
  }),
);

/** Every local message, unknown senders' included, oldest first. */
export const localMessagesAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const unknownSenderMessages = get(unknownSenderRowsAtom).flatMap((row) => {
      const message = toLocalNostrMessage(
        row,
        buildUnknownContactId(row.peerPubkey) ?? undefined,
      );
      return message ? [message] : [];
    });
    return keepUnchangedRows(
      Option.getOrUndefined(get.self<LocalNostrMessage[]>()),
      dedupeNostrMessagesByPriority([
        ...get(contactMessagesAtom),
        ...unknownSenderMessages,
      ]).sort((a, b) => a.createdAtSec - b.createdAtSec),
    );
  }),
);

export interface StoredReactions {
  /** Keys of reactions whose removal is stored, possibly before they arrived. */
  readonly deletedKeys: ReadonlySet<string>;
  readonly reactions: ReadonlyArray<LocalNostrReaction>;
  /** Keys of every stored reaction and removal. */
  readonly seenKeys: ReadonlySet<string>;
}

export const storedReactionsAtom = Atom.keepAlive(
  Atom.readable((get): StoredReactions => {
    const keyOf = (row: ReactionRow): string | null =>
      storedReactionKey(row.reactorPubkey, row.wrapId);
    const deletedKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of get(removedReactionRowsAtom)) {
      const key = keyOf(row);
      if (!key) continue;
      deletedKeys.add(key);
      seenKeys.add(key);
    }
    const reactions: LocalNostrReaction[] = [];
    for (const row of get(reactionRowsAtom)) {
      const key = keyOf(row);
      if (key) seenKeys.add(key);
      const normalized = toLocalNostrReaction(row);
      if (normalized) reactions.push(normalized);
    }
    return { deletedKeys, reactions, seenKeys };
  }),
);

/** The reactions still standing, one per wrap and client id, oldest first. */
export const localReactionsAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const stored = get(storedReactionsAtom);
    const parsed: LocalNostrReaction[] = [];
    const seenWrapIds = new Set<string>();
    const seenClientIds = new Set<string>();
    for (const normalized of stored.reactions) {
      const wrapId = trimString(normalized.wrapId);
      const key = storedReactionKey(normalized.reactorPubkey, wrapId);
      if (key !== null && stored.deletedKeys.has(key)) continue;
      if (wrapId && seenWrapIds.has(wrapId)) continue;
      if (wrapId) seenWrapIds.add(wrapId);

      const clientId = trimString(normalized.clientId);
      if (clientId && seenClientIds.has(clientId)) continue;
      if (clientId) seenClientIds.add(clientId);

      parsed.push(normalized);
    }
    parsed.sort((a, b) => a.createdAtSec - b.createdAtSec);
    return keepUnchangedRows(
      Option.getOrUndefined(get.self<LocalNostrReaction[]>()),
      parsed,
    );
  }),
);

export interface MessagesByContact {
  readonly messagesByContactId: ReadonlyMap<string, LocalNostrMessage[]>;
  /** The newest message per contact that is not an identity change notice. */
  readonly lastMessageByContactId: ReadonlyMap<string, LocalNostrMessage>;
  /** The newest hundred messages, newest first. */
  readonly recentMessages: ReadonlyArray<LocalNostrMessage>;
}

export const messagesByContactAtom = Atom.keepAlive(
  Atom.readable((get): MessagesByContact => {
    const previous = Option.getOrUndefined(get.self<MessagesByContact>());
    const messages = get(localMessagesAtom);
    const isShownInChat = get(isShownInChatAtom);
    const byContact = new Map<string, LocalNostrMessage[]>();
    const lastBy = new Map<string, LocalNostrMessage>();

    for (const message of messages) {
      const id = trimString(message.contactId);
      if (!id) continue;

      const list = byContact.get(id);
      if (list) list.push(message);
      else byContact.set(id, [message]);

      if (
        !isIdentityChangeMessageContent(message.content) &&
        isShownInChat(message)
      ) {
        lastBy.set(id, message);
      }
    }

    const recentMessages = messages.slice(-100).reverse();

    return {
      messagesByContactId: keepUnchangedLists(
        previous?.messagesByContactId,
        byContact,
      ),
      lastMessageByContactId: lastBy,
      recentMessages:
        previous && sameItems(previous.recentMessages, recentMessages)
          ? previous.recentMessages
          : recentMessages,
    };
  }),
);

const contactMessagesFamily = Atom.family((contactId: string) =>
  Atom.readable(
    (get) =>
      get(messagesByContactAtom).messagesByContactId.get(contactId) ??
      NO_MESSAGES,
  ),
);

const chatMessagesFamily = Atom.family((contactId: string) =>
  Atom.readable((get) => {
    const isShownInChat = get(isShownInChatAtom);
    return dedupeChatMessages(
      get(contactMessagesFamily(contactId)).filter(isShownInChat),
    );
  }),
);

const noChatMessagesAtom = Atom.readable(() => NO_MESSAGES);

/**
 * One contact's conversation, without duplicate copies of a message; it
 * changes only with that conversation.
 */
export const chatMessagesAtom = (
  contactId: string | null,
): Atom.Atom<LocalNostrMessage[]> => {
  const id = trimString(contactId);
  return id ? chatMessagesFamily(id) : noChatMessagesAtom;
};

export const reactionsByMessageIdAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const previous = Option.getOrUndefined(
      get.self<ReadonlyMap<string, LocalNostrReaction[]>>(),
    );
    const byMessage = new Map<string, LocalNostrReaction[]>();
    for (const reaction of get(localReactionsAtom)) {
      const messageId = trimString(reaction.messageId);
      if (!messageId) continue;
      const list = byMessage.get(messageId);
      if (list) list.push(reaction);
      else byMessage.set(messageId, [reaction]);
    }
    return keepUnchangedLists(previous, byMessage);
  }),
);
