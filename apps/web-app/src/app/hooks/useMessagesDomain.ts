import type { Pubkey } from "@linky/linkstr";
import { readPendingPayments } from "../lib/pendingPayments";
import {
  ContactId,
  createId,
  directConversationIdFor,
  MessageId,
  ReactionId,
  type ConversationsRepository,
  type MessageRow,
  type ReactionRow,
} from "@linky/linksync";
import { useLiveValue } from "@linky/linksync/react";
import { Effect, Schema } from "effect";
import React from "react";
import { useLatest } from "../../hooks/useLatest";
import type { Route } from "../../types/route";
import {
  LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
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
import { runWrite } from "../lib/storeWrite";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
  LocalPendingPayment,
  NewLocalNostrMessage,
  NewLocalNostrReaction,
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
  type NostrMessageShadowState,
  type NostrReactionShadowState,
} from "./messages/messageUpdates";
import { useConversationRows } from "./useLinksync";

interface UseMessagesDomainParams {
  appOwnerId: string | null;
  appOwnerIdRef: React.MutableRefObject<string | null>;
  chatForceScrollToBottomRef: React.MutableRefObject<boolean>;
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  contacts: ReadonlyArray<{ readonly id: ContactId }>;
  conversations: ConversationsRepository;
  route: Route;
}

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

export const useMessagesDomain = ({
  appOwnerId,
  appOwnerIdRef,
  chatForceScrollToBottomRef,
  chatMessagesRef,
  contacts,
  conversations,
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
    (what: string, effect: Effect.Effect<void, unknown>) => {
      writeQueueRef.current = writeQueueRef.current
        .then(() => runWrite(effect))
        .then((outcome) => {
          if (outcome.ok) return;
          console.warn(`[linky][messages] ${what} write failed`, outcome);
        });
    },
    [],
  );

  const normalizedReactionRows = React.useMemo(() => {
    const deletedWrapIds = new Set<string>();
    const seenWrapIds = new Set<string>();
    for (const row of removedReactionRows) {
      const wrapId = trimString(row.wrapId);
      if (!wrapId) continue;
      deletedWrapIds.add(wrapId);
      seenWrapIds.add(wrapId);
    }
    const reactions: LocalNostrReaction[] = [];
    for (const row of reactionRows) {
      const wrapId = trimString(row.wrapId);
      if (wrapId) seenWrapIds.add(wrapId);
      const normalized = toLocalNostrReaction(row);
      if (normalized) reactions.push(normalized);
    }
    return { deletedWrapIds, reactions, seenWrapIds };
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

  const persistOverlayMessages = React.useCallback(
    (nextMessages: LocalNostrMessage[]) => {
      setOverlayMessages(nextMessages);
      const ownerId = appOwnerIdRef.current;
      if (!ownerId) return;
      safeLocalStorageSetJson(
        overlayMessagesKeyForOwner(ownerId),
        nextMessages,
      );
    },
    [appOwnerIdRef],
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

  const overlayMessagesRef = useLatest(overlayMessages);

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
      if (wrapId && normalizedReactionRows.deletedWrapIds.has(wrapId)) continue;
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

  const nostrMessageWrapIdsRef = React.useRef<Set<string>>(new Set());
  const nostrMessagesLatestRef = React.useRef<LocalNostrMessage[]>([]);
  const nostrMessageUpdateShadowRef = React.useRef<
    Map<string, NostrMessageShadowState>
  >(new Map());
  const nostrReactionWrapIdsRef = React.useRef<Set<string>>(new Set());
  const nostrReactionsLatestRef = useLatest(nostrReactionsLocal);
  const nostrReactionUpdateShadowRef = React.useRef<
    Map<string, NostrReactionShadowState>
  >(new Map());

  React.useEffect(() => {
    nostrMessagesLatestRef.current = nostrMessagesLocal;
    nostrMessageUpdateShadowRef.current.clear();
    nostrMessageWrapIdsRef.current = new Set(
      nostrMessagesLocal
        .map((message) => trimString(message.wrapId) || trimString(message.id))
        .filter(Boolean),
    );
  }, [nostrMessagesLocal]);

  React.useEffect(() => {
    nostrReactionUpdateShadowRef.current.clear();
    nostrReactionWrapIdsRef.current = new Set(
      normalizedReactionRows.seenWrapIds,
    );
  }, [normalizedReactionRows, nostrReactionsLocal]);

  /** Stores a message for a saved contact; null when the payload is not storable. */
  const insertNostrMessage = React.useCallback(
    (message: NewLocalNostrMessage): LocalNostrMessage | null => {
      const contactId = parseContactId(trimString(message.contactId));
      if (!contactId) return null;
      const id = createId<"Message">();
      const wrapId = trimString(message.wrapId) || `pending:${makeLocalId()}`;
      const row = toMessageWriteRow(
        id,
        directConversationIdFor(contactId),
        message,
        wrapId,
      );
      if (!row) return null;
      write(
        "message",
        Effect.flatMap(conversations.ensureDirect(contactId), () =>
          conversations.messages.insert(row),
        ),
      );
      return localMessageFrom(message, id, wrapId);
    },
    [conversations, write],
  );

  const removeNostrMessage = React.useCallback(
    (id: string) => {
      const messageId = parseMessageId(id);
      if (messageId)
        write("message removal", conversations.messages.remove(messageId));
    },
    [conversations, write],
  );

  const removeNostrReaction = React.useCallback(
    (id: string) => {
      const reactionId = parseReactionId(id);
      if (reactionId)
        write("reaction removal", conversations.reactions.remove(reactionId));
    },
    [conversations, write],
  );

  const [pendingPayments, setPendingPayments] = React.useState<
    LocalPendingPayment[]
  >(() => []);

  const legacyImportDoneRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedMessageRows === null || legacyImportDoneRef.current) return;
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
            !insertNostrMessage({
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
  }, [insertNostrMessage, loadedMessageRows, nostrMessagesLocal]);

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

  const appendLocalNostrMessage = React.useCallback(
    (message: NewLocalNostrMessage): string => {
      const contactId = trimString(message.contactId);
      const direction = trimString(message.direction);
      const content = toText(message.content);
      if (!contactId || !direction || !content.trim()) return "";
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
      if (existing) return trimString(existing.id);

      if (isUnknownContactId(contactId)) {
        const nextMessage = localMessageFrom(
          message,
          makeLocalId(),
          wrapId || `pending:${makeLocalId()}`,
        );
        persistOverlayMessages(
          dedupeNostrMessagesByPriority([
            ...overlayMessagesRef.current,
            nextMessage,
          ]).sort((a, b) => a.createdAtSec - b.createdAtSec),
        );
        scrollActiveChatToBottom(contactId);
        return nextMessage.id;
      }

      const insertedMessage = insertNostrMessage(message);
      if (!insertedMessage) return "";
      nostrMessagesLatestRef.current = dedupeNostrMessagesByPriority([
        ...nostrMessagesLatestRef.current,
        insertedMessage,
      ]);
      nostrMessageWrapIdsRef.current.add(insertedMessage.wrapId);
      scrollActiveChatToBottom(contactId);
      return insertedMessage.id;
    },
    [
      insertNostrMessage,
      overlayMessagesRef,
      persistOverlayMessages,
      scrollActiveChatToBottom,
    ],
  );

  const updateLocalNostrMessage = React.useCallback<UpdateLocalNostrMessage>(
    (id, updates) => {
      const normalizedId = trimString(id);
      if (!normalizedId) return;

      const current = nostrMessagesLatestRef.current.find(
        (message) => trimString(message.id) === normalizedId,
      );
      const isOverlayMessage = overlayMessagesRef.current.some(
        (message) => trimString(message.id) === normalizedId,
      );
      const shadow: NostrMessageShadowState =
        nostrMessageUpdateShadowRef.current.get(normalizedId) ?? {};

      const payload = buildMessageUpdate(
        normalizedId,
        updates,
        current,
        shadow,
      );
      if (!payload) return;

      nostrMessageUpdateShadowRef.current.set(normalizedId, shadow);

      if (isOverlayMessage && current) {
        persistOverlayMessages(
          overlayMessagesRef.current.map((message) =>
            trimString(message.id) === normalizedId
              ? applyMessageUpdate(message, payload)
              : message,
          ),
        );
        return;
      }

      const messageId = parseMessageId(normalizedId);
      if (!messageId) return;
      write(
        "message update",
        conversations.messages.update(messageId, toMessagePatch(payload)),
      );
    },
    [conversations, overlayMessagesRef, persistOverlayMessages, write],
  );

  const appendLocalNostrReaction = React.useCallback(
    (reaction: NewLocalNostrReaction): string => {
      const messageId = trimString(reaction.messageId);
      const reactorPubkey = trimString(reaction.reactorPubkey);
      const emoji = toText(reaction.emoji).trim();
      if (!messageId || !reactorPubkey || !emoji) return "";
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
      if (existing) return trimString(existing.id);

      // A reaction belongs to the conversation of the message it targets.
      const target = nostrMessagesLatestRef.current.find(
        (message) => trimString(message.rumorId) === messageId,
      );
      const contactId = target ? parseContactId(target.contactId) : null;
      if (!contactId) return "";
      const id = createId<"Reaction">();
      const row = toReactionWriteRow(
        id,
        directConversationIdFor(contactId),
        reaction,
        wrapId || `pending:${makeLocalId()}`,
      );
      if (!row) return "";
      write(
        "reaction",
        Effect.flatMap(conversations.ensureDirect(contactId), () =>
          conversations.reactions.insert(row),
        ),
      );
      return id;
    },
    [conversations, nostrReactionsLatestRef, write],
  );

  const updateLocalNostrReaction = React.useCallback<UpdateLocalNostrReaction>(
    (id, updates) => {
      const normalizedId = trimString(id);
      if (!normalizedId) return;

      const current = nostrReactionsLatestRef.current.find(
        (reaction) => trimString(reaction.id) === normalizedId,
      );
      const shadow: NostrReactionShadowState =
        nostrReactionUpdateShadowRef.current.get(normalizedId) ?? {};

      const payload = buildReactionUpdate(
        normalizedId,
        updates,
        current,
        shadow,
      );
      if (!payload) return;

      nostrReactionUpdateShadowRef.current.set(normalizedId, shadow);
      const reactionId = parseReactionId(normalizedId);
      if (!reactionId) return;
      write(
        "reaction update",
        conversations.reactions.update(reactionId, toReactionPatch(payload)),
      );
    },
    [conversations, nostrReactionsLatestRef, write],
  );

  const softDeleteLocalNostrReaction = React.useCallback(
    (id: string) => {
      const normalizedId = trimString(id);
      if (normalizedId) removeNostrReaction(normalizedId);
    },
    [removeNostrReaction],
  );

  const softDeleteLocalNostrReactionsByWrapIds = React.useCallback(
    (wrapIds: readonly string[]) => {
      const targetWrapIds = new Set(
        wrapIds.map((value) => trimString(value)).filter(Boolean),
      );
      if (targetWrapIds.size === 0) return;

      for (const wrapId of targetWrapIds) {
        nostrReactionWrapIdsRef.current.add(wrapId);
      }

      for (const reaction of nostrReactionsLatestRef.current) {
        if (!targetWrapIds.has(trimString(reaction.wrapId))) continue;
        removeNostrReaction(reaction.id);
      }
    },
    [nostrReactionsLatestRef, removeNostrReaction],
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
        if (targetContactId === null || !insertNostrMessage(movedMessage))
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
        write(
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
      insertNostrMessage,
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

  React.useEffect(() => {
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
  }, [nostrMessagesLocal, nostrReactionsLocal, pruneRetention]);

  React.useEffect(() => {
    return () => {
      if (retentionPruneTimerRef.current != null) {
        window.clearTimeout(retentionPruneTimerRef.current);
        retentionPruneTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const ownerId = appOwnerIdRef.current;
    if (!ownerId) {
      setPendingPayments([]);
      return;
    }

    const normalized = readPendingPayments(
      `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${ownerId}`,
    );

    setPendingPayments(normalized);
  }, [appOwnerId, appOwnerIdRef]);

  const enqueuePendingPayment = React.useCallback(
    (payload: {
      amountSat: number;
      recipientPubkey: Pubkey;
      contactId: ContactId;
      messageId?: string;
    }) => {
      const ownerId = appOwnerIdRef.current;
      if (!ownerId) return;

      const amountSat =
        Number.isFinite(payload.amountSat) && payload.amountSat > 0
          ? Math.trunc(payload.amountSat)
          : 0;
      if (amountSat <= 0) return;

      const entry: LocalPendingPayment = {
        id: makeLocalId(),
        contactId: toText(payload.contactId),
        amountSat,
        recipientPubkey: payload.recipientPubkey,
        createdAtSec: nowSeconds(),
        ...(payload.messageId ? { messageId: payload.messageId } : {}),
      };

      setPendingPayments((prev) => {
        const next = [...prev, entry].slice(-200);
        safeLocalStorageSetJson(
          `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${ownerId}`,
          next,
        );
        return next;
      });
    },
    [appOwnerIdRef],
  );

  const removePendingPayment = React.useCallback(
    (id: string) => {
      const ownerId = appOwnerIdRef.current;
      const normalizedId = trimString(id);
      if (!ownerId || !normalizedId) return;

      setPendingPayments((prev) => {
        const next = prev.filter(
          (pendingPayment) => trimString(pendingPayment.id) !== normalizedId,
        );

        safeLocalStorageSetJson(
          `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${ownerId}`,
          next,
        );

        return next;
      });
    },
    [appOwnerIdRef],
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
    nostrReactionWrapIdsRef,
    nostrReactionsLocal,
    pendingPayments,
    reactionsByMessageId,
    reassignLocalNostrMessagesContactId,
    removeLocalNostrMessagesByContactId,
    removePendingPayment,
    softDeleteLocalNostrReaction,
    softDeleteLocalNostrReactionsByWrapIds,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  };
};
