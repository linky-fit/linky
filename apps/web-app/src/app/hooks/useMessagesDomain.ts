import {
  isPubkey,
  isRumorId,
  type Pubkey,
  type RumorId,
} from "@linky-fit/linkstr";
import { enqueueStoredPendingPayment } from "../lib/pendingPayments";
import {
  ContactId,
  createId,
  directConversationIdFor,
  MessageId,
  NonEmptyString1000,
  nostrMessageIdFor,
  nostrReactionIdFor,
  ReactionId,
  RowNotFound,
  type ConversationsRepository,
  type MessageRow,
  type ReactionRow,
} from "@linky-fit/linksync";
import { useLiveValue } from "@linky-fit/linksync/react";
import { Effect, Schema } from "effect";
import React from "react";
import { useLatest } from "../../hooks/useLatest";
import type { Route } from "../../types/route";
import {
  LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { UnknownRecord } from "../../utils/schema";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { makeLocalId, trimString } from "../../utils/validation";
import { nowSeconds } from "../../utils/time";
import { isIdentityChangeMessageContent } from "../lib/identityChangeMessage";
import {
  allWrites,
  NO_WRITE,
  runWrite,
  type WriteOutcome,
} from "../lib/storeWrite";
import type {
  AppendedRow,
  AppendLocalNostrMessage,
  AppendLocalNostrReaction,
  LocalNostrMessage,
  LocalNostrReaction,
  NewLocalNostrMessage,
  UpdateLocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../types/appTypes";
import { isUnknownContactId } from "./messages/contactIdentity";
import {
  dedupeChatMessages,
  dedupeNostrMessagesByPriority,
  getLocalNostrMessageRumorKey,
} from "./messages/messageHelpers";
import {
  contactIdByConversationId,
  localMessageFrom,
  normalizeLegacyLocalMessage,
  toLocalNostrMessage,
  toLocalNostrReaction,
  toMessagePatch,
  toMessageWriteRow,
  toReactionPatch,
  toReactionWriteRow,
} from "./messages/messageRows";
import {
  applyMessageUpdate,
  buildMessageUpdate,
  buildReactionUpdate,
} from "./messages/messageUpdates";
import { reactionKey, storedReactionKey } from "./messages/reactionInbox";
import { useConversationRows } from "./useLinksync";

interface UseMessagesDomainParams {
  appOwnerId: string | null;
  appOwnerIdRef: React.MutableRefObject<string | null>;
  chatForceScrollToBottomRef: React.MutableRefObject<boolean>;
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  contacts: ReadonlyArray<{ readonly id: ContactId }>;
  conversations: ConversationsRepository;
  /** Background writes (legacy import, retention prune) wait until the account is hydrated. */
  hydrated: boolean;
  route: Route;
}

// removal gate in app/migrations/AGENTS.md
const MESSAGE_MIGRATION_VERSION = 1;
const MESSAGE_RETENTION_PER_CONTACT = 500;
const MESSAGE_RETENTION_GLOBAL = 3000;
const REACTION_RETENTION_GLOBAL = 5000;
const RETENTION_PRUNE_THROTTLE_MS = 900;

const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toMessageStatus = (value: unknown): "pending" | "sent" =>
  trimString(value) === "pending" ? "pending" : "sent";

const migrationKeyForOwner = (ownerId: string): string =>
  `linky.messages_evolu_migrated_v${MESSAGE_MIGRATION_VERSION}:${ownerId}`;

const LEGACY_MESSAGES_KEY_PREFIX = `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.`;
const OVERLAY_KEY_INFIX = ".overlay.";

const overlayMessagesKeyForOwner = (ownerId: string): string =>
  `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}${OVERLAY_KEY_INFIX}${ownerId}`;

/** The pre-Evolu message stores still on this device, keyed by the owner they were written for. */
const legacyLocalMessageOwnerIds = (): string[] =>
  safeLocalStorageKeys()
    .filter(
      (key) =>
        key.startsWith(LEGACY_MESSAGES_KEY_PREFIX) &&
        !key.includes(OVERLAY_KEY_INFIX),
    )
    .map((key) => key.slice(LEGACY_MESSAGES_KEY_PREFIX.length))
    .filter(Boolean);

const parseContactId = (value: string): ContactId | null => {
  const result = ContactId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const parseMessageId = (value: string): MessageId | null => {
  const result = MessageId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const parseReactionId = (value: string): ReactionId | null => {
  const result = ReactionId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const NO_ROWS: ReadonlyArray<never> = [];

const NOT_APPENDED: AppendedRow = { id: "", written: NO_WRITE };

interface StoredMessage {
  readonly message: LocalNostrMessage;
  readonly written: Promise<WriteOutcome>;
}

/** The id every device gives a message from Nostr; null for a send that has no rumor yet. */
const nostrMessageIdOf = (message: NewLocalNostrMessage): MessageId | null => {
  const rumorId = trimString(message.rumorId);
  return isRumorId(rumorId) ? nostrMessageIdFor(rumorId) : null;
};

export const useMessagesDomain = ({
  appOwnerId,
  appOwnerIdRef,
  chatForceScrollToBottomRef,
  chatMessagesRef,
  contacts,
  conversations,
  hydrated,
  route,
}: UseMessagesDomainParams) => {
  const activeChatRouteId =
    route.kind === "chat"
      ? route.id
      : route.kind === "bankPaymentOffer"
        ? route.chatId
        : null;
  const [overlayMessages, setOverlayMessages] = React.useState<
    LocalNostrMessage[]
  >([]);

  // Null until the first read answers, so the legacy import below cannot
  // duplicate rows it has not seen yet.
  const messageSource = React.useMemo(
    () => ({
      all: conversations.messages.all,
      subscribe: conversations.messages.subscribe,
    }),
    [conversations],
  );
  const loadedMessageRows = useLiveValue<ReadonlyArray<MessageRow> | null>(
    messageSource,
    null,
  );
  const messageRows = loadedMessageRows ?? NO_ROWS;
  const reactionSource = React.useMemo(
    () => ({
      all: conversations.reactions.all,
      subscribe: conversations.reactions.subscribe,
    }),
    [conversations],
  );
  const reactionRows = useLiveValue<ReadonlyArray<ReactionRow>>(
    reactionSource,
    NO_ROWS,
  );
  const removedReactionSource = React.useMemo(
    () => ({
      all: conversations.removedReactions,
      subscribe: conversations.reactions.subscribe,
    }),
    [conversations],
  );
  const removedReactionRows = useLiveValue<ReadonlyArray<ReactionRow>>(
    removedReactionSource,
    NO_ROWS,
  );
  const conversationRows = useConversationRows();

  const contactByConversation = React.useMemo(
    () => contactIdByConversationId(conversationRows, contacts),
    [contacts, conversationRows],
  );

  // Writes run one after another: an update issued right after an insert
  // (the send flow stamps the rumor id on its pending row) must find the row.
  const writeQueueRef = React.useRef(Promise.resolve());
  const write = React.useCallback(
    (
      what: string,
      effect: Effect.Effect<void, unknown>,
    ): Promise<WriteOutcome> => {
      const outcome = writeQueueRef.current.then(() => runWrite(effect));
      writeQueueRef.current = outcome.then((settled) => {
        if (settled.ok) return;
        console.warn(`[linky][messages] ${what} write failed`, settled);
      });
      return outcome;
    },
    [],
  );

  const normalizedReactionRows = React.useMemo(() => {
    const keyOf = (row: ReactionRow): string | null =>
      storedReactionKey(row.reactorPubkey, row.wrapId);
    const deletedKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of removedReactionRows) {
      const key = keyOf(row);
      if (!key) continue;
      deletedKeys.add(key);
      seenKeys.add(key);
    }
    const reactions: LocalNostrReaction[] = [];
    for (const row of reactionRows) {
      const key = keyOf(row);
      if (key) seenKeys.add(key);
      const normalized = toLocalNostrReaction(row);
      if (normalized) reactions.push(normalized);
    }
    return { deletedKeys, reactions, seenKeys };
  }, [reactionRows, removedReactionRows]);

  const evoluNostrMessagesLocal = React.useMemo(() => {
    const parsed: LocalNostrMessage[] = [];
    for (const row of messageRows) {
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
  }, [contactByConversation, messageRows]);

  const overlayMessagesRef = useLatest(overlayMessages);

  const persistOverlayMessages = React.useCallback(
    (nextMessages: LocalNostrMessage[]) => {
      // Messages arriving in one burst read the ref before React re-renders.
      overlayMessagesRef.current = nextMessages;
      setOverlayMessages(nextMessages);
      const ownerId = appOwnerIdRef.current;
      if (!ownerId) return;
      safeLocalStorageSetJson(
        overlayMessagesKeyForOwner(ownerId),
        nextMessages,
      );
    },
    [appOwnerIdRef, overlayMessagesRef],
  );

  React.useEffect(() => {
    const ownerId = appOwnerIdRef.current;
    if (!ownerId) {
      setOverlayMessages([]);
      return;
    }

    const normalized = safeLocalStorageGetJson(
      overlayMessagesKeyForOwner(ownerId),
      Schema.Array(UnknownRecord),
      [],
    )
      .map(normalizeLegacyLocalMessage)
      .filter((message): message is LocalNostrMessage => Boolean(message));

    setOverlayMessages(dedupeNostrMessagesByPriority(normalized));
  }, [appOwnerId, appOwnerIdRef]);

  const nostrMessagesLocal = React.useMemo(() => {
    const combined = dedupeNostrMessagesByPriority([
      ...evoluNostrMessagesLocal,
      ...overlayMessages,
    ]);
    return combined.sort((a, b) => a.createdAtSec - b.createdAtSec);
  }, [evoluNostrMessagesLocal, overlayMessages]);

  const nostrReactionsLocal = React.useMemo(() => {
    const parsed: LocalNostrReaction[] = [];
    const seenWrapIds = new Set<string>();
    const seenClientIds = new Set<string>();
    for (const normalized of normalizedReactionRows.reactions) {
      const wrapId = trimString(normalized.wrapId);
      const key = storedReactionKey(normalized.reactorPubkey, wrapId);
      if (key !== null && normalizedReactionRows.deletedKeys.has(key)) continue;
      if (wrapId && seenWrapIds.has(wrapId)) continue;
      if (wrapId) seenWrapIds.add(wrapId);

      const clientId = trimString(normalized.clientId);
      if (clientId && seenClientIds.has(clientId)) continue;
      if (clientId) seenClientIds.add(clientId);

      parsed.push(normalized);
    }
    parsed.sort((a, b) => a.createdAtSec - b.createdAtSec);
    return parsed;
  }, [normalizedReactionRows]);

  const nostrMessagesLatestRef = React.useRef<LocalNostrMessage[]>([]);
  const knownReactionKeysRef = React.useRef<Set<string>>(new Set());
  const nostrReactionsLatestRef = useLatest(nostrReactionsLocal);

  React.useEffect(() => {
    nostrMessagesLatestRef.current = nostrMessagesLocal;
  }, [nostrMessagesLocal]);

  React.useEffect(() => {
    knownReactionKeysRef.current = new Set(normalizedReactionRows.seenKeys);
  }, [normalizedReactionRows]);

  /** Stores a message for a saved contact; null when the payload is not storable. */
  const insertNostrMessage = React.useCallback(
    (
      message: NewLocalNostrMessage,
      id: MessageId,
      wrapId: string,
    ): StoredMessage | null => {
      const contactId = parseContactId(trimString(message.contactId));
      if (!contactId) return null;
      const row = toMessageWriteRow(
        id,
        directConversationIdFor(contactId),
        message,
        wrapId,
      );
      if (!row) return null;
      return {
        message: localMessageFrom(message, id, wrapId),
        written: write(
          "message",
          Effect.flatMap(conversations.ensureDirect(contactId), () =>
            conversations.messages.insertIfAbsent(row),
          ),
        ),
      };
    },
    [conversations, write],
  );

  const storeMessage = React.useCallback(
    (message: NewLocalNostrMessage): StoredMessage | null => {
      const id = nostrMessageIdOf(message) ?? createId<"Message">();
      const wrapId = trimString(message.wrapId) || `pending:${makeLocalId()}`;
      if (isUnknownContactId(message.contactId)) {
        const stored = localMessageFrom(message, id, wrapId);
        persistOverlayMessages(
          dedupeNostrMessagesByPriority([
            ...overlayMessagesRef.current,
            stored,
          ]).sort((a, b) => a.createdAtSec - b.createdAtSec),
        );
        return { message: stored, written: NO_WRITE };
      }
      return insertNostrMessage(message, id, wrapId);
    },
    [insertNostrMessage, overlayMessagesRef, persistOverlayMessages],
  );

  const removeNostrMessage = React.useCallback(
    (id: string) => {
      const messageId = parseMessageId(id);
      if (messageId)
        void write("message removal", conversations.messages.remove(messageId));
    },
    [conversations, write],
  );

  const removeNostrReaction = React.useCallback(
    (id: string): Promise<WriteOutcome> => {
      const reactionId = parseReactionId(id);
      return reactionId
        ? write("reaction removal", conversations.reactions.remove(reactionId))
        : NO_WRITE;
    },
    [conversations, write],
  );

  const legacyImportDoneRef = React.useRef(false);

  React.useEffect(() => {
    if (!hydrated || loadedMessageRows === null || legacyImportDoneRef.current)
      return;
    legacyImportDoneRef.current = true;

    const existingMessages = dedupeNostrMessagesByPriority(nostrMessagesLocal);
    const seenWrapIds = new Set<string>();
    const seenClientIds = new Set<string>();
    const seenRumorKeys = new Set<string>();
    for (const existingMessage of existingMessages) {
      const wrapId = trimString(existingMessage.wrapId);
      if (wrapId) seenWrapIds.add(wrapId);
      const clientId = trimString(existingMessage.clientId);
      if (clientId) seenClientIds.add(clientId);
      const rumorKey = getLocalNostrMessageRumorKey(existingMessage);
      if (rumorKey) seenRumorKeys.add(rumorKey);
    }

    for (const ownerKey of legacyLocalMessageOwnerIds()) {
      const migrationKey = migrationKeyForOwner(ownerKey);
      const storageKey = `${LEGACY_MESSAGES_KEY_PREFIX}${ownerKey}`;
      if (safeLocalStorageGet(migrationKey) !== "1") {
        const legacyMessages = dedupeNostrMessagesByPriority(
          safeLocalStorageGetJson(storageKey, Schema.Array(UnknownRecord), [])
            .map(normalizeLegacyLocalMessage)
            .filter((message): message is LocalNostrMessage =>
              Boolean(message),
            ),
        );
        for (const legacyMessage of legacyMessages) {
          const wrapId = trimString(legacyMessage.wrapId);
          const clientId = trimString(legacyMessage.clientId);
          const rumorKey = getLocalNostrMessageRumorKey(legacyMessage);
          if (wrapId && seenWrapIds.has(wrapId)) continue;
          if (clientId && seenClientIds.has(clientId)) continue;
          if (rumorKey && seenRumorKeys.has(rumorKey)) continue;
          if (
            !storeMessage({
              ...legacyMessage,
              status: toMessageStatus(legacyMessage.status),
            })
          )
            continue;
          if (wrapId) seenWrapIds.add(wrapId);
          if (clientId) seenClientIds.add(clientId);
          if (rumorKey) seenRumorKeys.add(rumorKey);
        }
        safeLocalStorageSet(migrationKey, "1");
      }
      safeLocalStorageRemove(storageKey);
    }
  }, [hydrated, loadedMessageRows, nostrMessagesLocal, storeMessage]);

  const scrollActiveChatToBottom = React.useCallback(
    (contactId: string) => {
      if (
        !activeChatRouteId ||
        trimString(contactId) !== trimString(activeChatRouteId)
      )
        return;
      chatForceScrollToBottomRef.current = true;
      requestAnimationFrame(() => {
        const container = chatMessagesRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    },
    [activeChatRouteId, chatForceScrollToBottomRef, chatMessagesRef],
  );

  const appendLocalNostrMessage = React.useCallback<AppendLocalNostrMessage>(
    (message) => {
      const contactId = trimString(message.contactId);
      const direction = trimString(message.direction);
      const content = toText(message.content);
      if (!contactId || !direction || !content.trim()) return NOT_APPENDED;
      const wrapId = trimString(message.wrapId);
      const clientId = trimString(message.clientId);
      const rumorId = trimString(message.rumorId);

      const existing = nostrMessagesLatestRef.current.find((current) => {
        if (clientId && trimString(current.clientId) === clientId) return true;
        if (wrapId && trimString(current.wrapId) === wrapId) return true;
        if (rumorId && trimString(current.rumorId) === rumorId) return true;
        return (
          trimString(current.contactId) === contactId &&
          trimString(current.direction) === direction &&
          toText(current.content) === content &&
          current.createdAtSec === message.createdAtSec
        );
      });
      if (existing) return { id: trimString(existing.id), written: NO_WRITE };

      const stored = storeMessage(message);
      if (!stored) return NOT_APPENDED;
      // Messages arriving in one burst read the ref before React re-renders.
      nostrMessagesLatestRef.current = dedupeNostrMessagesByPriority([
        ...nostrMessagesLatestRef.current,
        stored.message,
      ]);
      scrollActiveChatToBottom(contactId);
      return { id: stored.message.id, written: stored.written };
    },
    [scrollActiveChatToBottom, storeMessage],
  );

  const updateLocalNostrMessage = React.useCallback<UpdateLocalNostrMessage>(
    (id, updates) => {
      const normalizedId = trimString(id);
      const overlay = overlayMessagesRef.current.find(
        (message) => message.id === normalizedId,
      );
      if (overlay) {
        const payload = buildMessageUpdate(normalizedId, updates, {
          ...overlay,
          clientId: overlay.clientId ?? null,
          editedAtSec: overlay.editedAtSec ?? null,
          editedFromId: overlay.editedFromId ?? null,
          isEdited: overlay.isEdited ? "1" : null,
          localOnly: overlay.localOnly ? "1" : null,
          originalContent: overlay.originalContent ?? null,
          replyToContent: overlay.replyToContent ?? null,
          replyToId: overlay.replyToId ?? null,
          rootMessageId: overlay.rootMessageId ?? null,
          status: overlay.status ?? null,
        });
        if (payload)
          persistOverlayMessages(
            overlayMessagesRef.current.map((message) =>
              message.id === normalizedId
                ? applyMessageUpdate(message, payload)
                : message,
            ),
          );
        return NO_WRITE;
      }
      const messageId = parseMessageId(normalizedId);
      if (!messageId) return NO_WRITE;
      return write(
        "message update",
        Effect.gen(function* () {
          const current = yield* conversations.messages.byId(messageId);
          if (current === null)
            return yield* new RowNotFound({
              scope: "messages",
              table: "message",
              id: messageId,
            });
          const payload = buildMessageUpdate(messageId, updates, current);
          if (payload === null) return;
          yield* conversations.messages.update(
            messageId,
            toMessagePatch(payload),
          );
        }),
      );
    },
    [conversations, overlayMessagesRef, persistOverlayMessages, write],
  );

  const appendLocalNostrReaction = React.useCallback<AppendLocalNostrReaction>(
    (reaction) => {
      const messageId = trimString(reaction.messageId);
      const reactorPubkey = trimString(reaction.reactorPubkey);
      const emoji = toText(reaction.emoji).trim();
      if (!messageId || !reactorPubkey || !emoji) return NOT_APPENDED;
      const wrapId = trimString(reaction.wrapId);
      const clientId = trimString(reaction.clientId);

      const existing = nostrReactionsLatestRef.current.find((current) => {
        if (clientId && trimString(current.clientId) === clientId) return true;
        if (wrapId && trimString(current.wrapId) === wrapId) return true;
        return (
          trimString(current.messageId) === messageId &&
          trimString(current.reactorPubkey) === reactorPubkey &&
          trimString(current.emoji) === emoji &&
          current.createdAtSec === reaction.createdAtSec
        );
      });
      if (existing) return { id: trimString(existing.id), written: NO_WRITE };

      // A reaction belongs to the conversation of the message it targets.
      const target = nostrMessagesLatestRef.current.find(
        (message) => trimString(message.rumorId) === messageId,
      );
      const contactId = target ? parseContactId(target.contactId) : null;
      if (!contactId) return NOT_APPENDED;
      const id =
        isRumorId(wrapId) && isPubkey(reactorPubkey)
          ? nostrReactionIdFor(wrapId, reactorPubkey)
          : createId<"Reaction">();
      const row = toReactionWriteRow(
        id,
        directConversationIdFor(contactId),
        reaction,
        wrapId || `pending:${makeLocalId()}`,
      );
      if (!row) return NOT_APPENDED;
      return {
        id,
        written: write(
          "reaction",
          Effect.flatMap(conversations.ensureDirect(contactId), () =>
            conversations.reactions.insertIfAbsent(row),
          ),
        ),
      };
    },
    [conversations, nostrReactionsLatestRef, write],
  );

  const updateLocalNostrReaction = React.useCallback<UpdateLocalNostrReaction>(
    (id, updates) => {
      const reactionId = parseReactionId(trimString(id));
      if (!reactionId) return NO_WRITE;
      return write(
        "reaction update",
        Effect.gen(function* () {
          const current = yield* conversations.reactions.byId(reactionId);
          if (current === null)
            return yield* new RowNotFound({
              scope: "messages",
              table: "reaction",
              id: reactionId,
            });
          const payload = buildReactionUpdate(reactionId, updates, current);
          if (payload === null) return;
          yield* conversations.reactions.update(
            reactionId,
            toReactionPatch(payload),
          );
        }),
      );
    },
    [conversations, write],
  );

  const softDeleteLocalNostrReaction = React.useCallback(
    (id: string) => {
      const normalizedId = trimString(id);
      if (normalizedId) void removeNostrReaction(normalizedId);
    },
    [removeNostrReaction],
  );

  const softDeleteLocalNostrReactionsByWrapIds = React.useCallback(
    (wrapIds: readonly string[]): Promise<WriteOutcome> => {
      const targetWrapIds = new Set(
        wrapIds.map((value) => trimString(value)).filter(Boolean),
      );
      const removals: Array<Promise<WriteOutcome>> = [];
      for (const reaction of nostrReactionsLatestRef.current) {
        const wrapId = trimString(reaction.wrapId);
        if (!targetWrapIds.has(wrapId)) continue;
        const key = storedReactionKey(reaction.reactorPubkey, wrapId);
        if (key !== null) knownReactionKeysRef.current.add(key);
        removals.push(removeNostrReaction(reaction.id));
      }
      return allWrites(removals);
    },
    [nostrReactionsLatestRef, removeNostrReaction],
  );

  const storeRetractedReaction = React.useCallback(
    (reactionId: RumorId, retractor: Pubkey): Promise<WriteOutcome> => {
      knownReactionKeysRef.current.add(reactionKey(retractor, reactionId));
      const id = nostrReactionIdFor(reactionId, retractor);
      const recordRemoval = Effect.tap(
        conversations.reactions.removeIfAbsent({
          id,
          reactorPubkey: NonEmptyString1000.orThrow(retractor),
          wrapId: NonEmptyString1000.orThrow(reactionId),
        }),
        (stored) =>
          Effect.sync(() => {
            if (!stored) return;
            reportAppLog({
              tag: "reactions.retractionStored",
              summary:
                "Stored the removal of a reaction that has not arrived yet",
              links: { rumor: reactionId, reaction: id, pubkey: retractor },
              payload: null,
            });
          }),
      );
      return write(
        "reaction retraction",
        conversations.reactions
          .remove(id)
          .pipe(Effect.catchTag("RowNotFound", () => recordRemoval)),
      );
    },
    [conversations, write],
  );

  const reassignLocalNostrMessagesContactId = React.useCallback(
    (fromContactId: string, toContactId: string) => {
      const normalizedFrom = trimString(fromContactId);
      const normalizedTo = trimString(toContactId);
      if (!normalizedFrom || !normalizedTo) return 0;

      const movedMessageIds = new Set<string>();
      const targetContactId = isUnknownContactId(normalizedTo)
        ? null
        : parseContactId(normalizedTo);
      const nextOverlayMessages: LocalNostrMessage[] = [];

      for (const message of overlayMessagesRef.current) {
        if (trimString(message.contactId) !== normalizedFrom) {
          nextOverlayMessages.push(message);
          continue;
        }
        movedMessageIds.add(trimString(message.id));
        const movedMessage = { ...message, contactId: normalizedTo };
        if (targetContactId === null || !storeMessage(movedMessage))
          nextOverlayMessages.push(movedMessage);
      }

      for (const message of evoluNostrMessagesLocal) {
        if (trimString(message.contactId) !== normalizedFrom) continue;
        const id = trimString(message.id);
        if (!id) continue;
        movedMessageIds.add(id);
        if (targetContactId === null) {
          nextOverlayMessages.push({ ...message, contactId: normalizedTo });
          removeNostrMessage(id);
          continue;
        }
        const messageId = parseMessageId(id);
        if (!messageId) continue;
        void write(
          "message move",
          Effect.flatMap(conversations.ensureDirect(targetContactId), () =>
            conversations.messages.update(messageId, {
              conversationId: directConversationIdFor(targetContactId),
            }),
          ),
        );
      }

      persistOverlayMessages(
        dedupeNostrMessagesByPriority(nextOverlayMessages).sort(
          (a, b) => a.createdAtSec - b.createdAtSec,
        ),
      );

      return movedMessageIds.size;
    },
    [
      conversations,
      evoluNostrMessagesLocal,
      storeMessage,
      overlayMessagesRef,
      persistOverlayMessages,
      removeNostrMessage,
      write,
    ],
  );

  const removeLocalNostrMessagesByContactId = React.useCallback(
    (contactId: string) => {
      const normalizedContactId = trimString(contactId);
      if (!normalizedContactId) return;
      persistOverlayMessages(
        overlayMessagesRef.current.filter(
          (message) => trimString(message.contactId) !== normalizedContactId,
        ),
      );
      for (const message of evoluNostrMessagesLocal) {
        if (trimString(message.contactId) !== normalizedContactId) continue;
        removeNostrMessage(message.id);
      }
    },
    [
      evoluNostrMessagesLocal,
      overlayMessagesRef,
      persistOverlayMessages,
      removeNostrMessage,
    ],
  );

  const retentionPruneTimerRef = React.useRef<number | null>(null);
  const retentionPruneInFlightRef = React.useRef(false);

  const pruneRetention = React.useCallback(() => {
    if (retentionPruneInFlightRef.current) return;

    retentionPruneInFlightRef.current = true;
    try {
      const byContact = new Map<string, LocalNostrMessage[]>();
      for (const message of nostrMessagesLocal) {
        const contactId = trimString(message.contactId);
        if (!contactId) continue;
        const list = byContact.get(contactId);
        if (list) list.push(message);
        else byContact.set(contactId, [message]);
      }

      const keepIds = new Set<string>();
      for (const list of byContact.values()) {
        const sorted = [...list].sort(
          (a, b) => a.createdAtSec - b.createdAtSec,
        );
        for (const message of sorted.slice(-MESSAGE_RETENTION_PER_CONTACT)) {
          keepIds.add(trimString(message.id));
        }
      }

      const keptMessagesSorted = nostrMessagesLocal
        .filter((message) => keepIds.has(trimString(message.id)))
        .sort((a, b) => a.createdAtSec - b.createdAtSec);

      if (keptMessagesSorted.length > MESSAGE_RETENTION_GLOBAL) {
        const limited = keptMessagesSorted.slice(-MESSAGE_RETENTION_GLOBAL);
        keepIds.clear();
        for (const message of limited) {
          keepIds.add(trimString(message.id));
        }
      }

      const overlayMessageIds = new Set(
        overlayMessagesRef.current
          .map((message) => trimString(message.id))
          .filter(Boolean),
      );
      for (const message of nostrMessagesLocal) {
        const messageId = trimString(message.id);
        if (!messageId || keepIds.has(messageId)) continue;
        if (overlayMessageIds.has(messageId)) continue;
        removeNostrMessage(messageId);
      }

      const nextOverlayMessages = overlayMessagesRef.current.filter((message) =>
        keepIds.has(trimString(message.id)),
      );
      if (nextOverlayMessages.length !== overlayMessagesRef.current.length) {
        persistOverlayMessages(nextOverlayMessages);
      }

      const keptRumorIds = new Set<string>();
      for (const message of nostrMessagesLocal) {
        if (!keepIds.has(trimString(message.id))) continue;
        const rumorId = trimString(message.rumorId);
        if (rumorId) keptRumorIds.add(rumorId);
      }

      const validReactions = nostrReactionsLocal
        .filter((reaction) => keptRumorIds.has(trimString(reaction.messageId)))
        .sort((a, b) => a.createdAtSec - b.createdAtSec);

      const keepReactionIds = new Set<string>(
        validReactions
          .slice(-REACTION_RETENTION_GLOBAL)
          .map((reaction) => trimString(reaction.id))
          .filter(Boolean),
      );

      for (const reaction of nostrReactionsLocal) {
        const reactionId = trimString(reaction.id);
        if (!reactionId || keepReactionIds.has(reactionId)) continue;
        removeNostrReaction(reactionId);
      }
    } finally {
      retentionPruneInFlightRef.current = false;
    }
  }, [
    overlayMessagesRef,
    nostrMessagesLocal,
    nostrReactionsLocal,
    persistOverlayMessages,
    removeNostrMessage,
    removeNostrReaction,
  ]);

  // Before hydration a reaction's message may not have arrived yet, so it would look orphaned.
  React.useEffect(() => {
    if (!hydrated) return;
    const messageCountsByContact = new Map<string, number>();
    for (const message of nostrMessagesLocal) {
      const contactId = trimString(message.contactId);
      if (!contactId) continue;
      messageCountsByContact.set(
        contactId,
        (messageCountsByContact.get(contactId) ?? 0) + 1,
      );
    }
    const hasContactOverflow = [...messageCountsByContact.values()].some(
      (count) => count > MESSAGE_RETENTION_PER_CONTACT,
    );
    const hasMessageOverflow =
      nostrMessagesLocal.length > MESSAGE_RETENTION_GLOBAL;
    const messageRumorIds = new Set(
      nostrMessagesLocal
        .map((message) => trimString(message.rumorId))
        .filter(Boolean),
    );
    const hasOrphanReaction = nostrReactionsLocal.some(
      (reaction) => !messageRumorIds.has(trimString(reaction.messageId)),
    );
    const hasReactionOverflow =
      nostrReactionsLocal.length > REACTION_RETENTION_GLOBAL;

    if (
      !hasContactOverflow &&
      !hasMessageOverflow &&
      !hasOrphanReaction &&
      !hasReactionOverflow
    ) {
      return;
    }

    if (retentionPruneTimerRef.current != null) return;
    retentionPruneTimerRef.current = window.setTimeout(() => {
      retentionPruneTimerRef.current = null;
      pruneRetention();
    }, RETENTION_PRUNE_THROTTLE_MS);
  }, [hydrated, nostrMessagesLocal, nostrReactionsLocal, pruneRetention]);

  React.useEffect(() => {
    return () => {
      if (retentionPruneTimerRef.current != null) {
        window.clearTimeout(retentionPruneTimerRef.current);
        retentionPruneTimerRef.current = null;
      }
    };
  }, []);

  const pendingPaymentsKey = appOwnerId
    ? `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${appOwnerId}`
    : null;

  const enqueuePendingPayment = React.useCallback(
    (payload: {
      amountSat: number;
      recipientPubkey: Pubkey;
      contactId: ContactId;
      messageId?: string;
    }) => {
      const amountSat =
        Number.isFinite(payload.amountSat) && payload.amountSat > 0
          ? Math.trunc(payload.amountSat)
          : 0;
      if (!pendingPaymentsKey || amountSat <= 0) return;

      void enqueueStoredPendingPayment(pendingPaymentsKey, {
        id: makeLocalId(),
        contactId: toText(payload.contactId),
        amountSat,
        recipientPubkey: payload.recipientPubkey,
        createdAtSec: nowSeconds(),
        ...(payload.messageId ? { messageId: payload.messageId } : {}),
      });
    },
    [pendingPaymentsKey],
  );

  const chatContactId = activeChatRouteId;

  const { messagesByContactId, lastMessageByContactId, nostrMessagesRecent } =
    React.useMemo(() => {
      const byContact = new Map<string, LocalNostrMessage[]>();
      const lastBy = new Map<string, LocalNostrMessage>();

      for (const message of nostrMessagesLocal) {
        const id = trimString(message.contactId);
        if (!id) continue;

        const list = byContact.get(id);
        if (list) list.push(message);
        else byContact.set(id, [message]);

        if (!isIdentityChangeMessageContent(message.content)) {
          lastBy.set(id, message);
        }
      }

      const recentSlice =
        nostrMessagesLocal.length > 100
          ? nostrMessagesLocal.slice(-100)
          : [...nostrMessagesLocal];

      return {
        messagesByContactId: byContact,
        lastMessageByContactId: lastBy,
        nostrMessagesRecent: [...recentSlice].reverse(),
      };
    }, [nostrMessagesLocal]);

  const reactionsByMessageId = React.useMemo(() => {
    const byMessage = new Map<string, LocalNostrReaction[]>();
    for (const reaction of nostrReactionsLocal) {
      const messageId = trimString(reaction.messageId);
      if (!messageId) continue;
      const list = byMessage.get(messageId);
      if (list) list.push(reaction);
      else byMessage.set(messageId, [reaction]);
    }
    return byMessage;
  }, [nostrReactionsLocal]);

  const chatMessages = React.useMemo<LocalNostrMessage[]>(() => {
    const id = trimString(chatContactId);
    if (!id) return [];

    const list = messagesByContactId.get(id) ?? [];
    return dedupeChatMessages(list);
  }, [chatContactId, messagesByContactId]);

  return {
    appendLocalNostrMessage,
    appendLocalNostrReaction,
    chatMessages,
    enqueuePendingPayment,
    lastMessageByContactId,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrMessagesRecent,
    knownReactionKeysRef,
    nostrReactionsLocal,
    pendingPaymentsKey,
    reactionsByMessageId,
    reassignLocalNostrMessagesContactId,
    removeLocalNostrMessagesByContactId,
    softDeleteLocalNostrReaction,
    softDeleteLocalNostrReactionsByWrapIds,
    storeRetractedReaction,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  };
};
