import type { Pubkey, RumorId } from "@linky-fit/linkstr";
import {
  NonEmptyString1000,
  nostrReactionIdFor,
  type ConversationsRepository,
  type UnknownSendersRepository,
} from "@linky-fit/linksync";
import { useAtomSuspense, useAtomValue } from "@linky-fit/linkstr-react";
import { Effect, Schema } from "effect";
import React from "react";
import { useLatest } from "../../hooks/useLatest";
import type { Route } from "../../types/route";
import { LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX } from "../../utils/constants";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { UnknownRecord } from "../../utils/schema";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";
import { trimString } from "../../utils/validation";
import { allWrites, type WriteOutcome } from "../lib/storeWrite";
import {
  chatWritesAtom,
  pendingPaymentsKeyFor,
} from "../state/messages/chatWrites";
import {
  chatMessagesAtom,
  localMessagesAtom,
  localReactionsAtom,
  messageRowsAtom,
  messagesByContactAtom,
  reactionsByMessageIdAtom,
  storedReactionsAtom,
} from "../state/messages/readModel";
import { useMessageWrites } from "./messages/useMessageWrites";
import { useUnknownSenderOverlayMigration } from "../migrations/useUnknownSenderOverlayMigration";
import type { LocalNostrMessage } from "../types/appTypes";
import {
  dedupeNostrMessagesByPriority,
  getLocalNostrMessageClientKey,
  getLocalNostrMessageRumorKey,
} from "./messages/messageHelpers";
import { normalizeLegacyLocalMessage } from "./messages/messageRows";
import { reactionKey, storedReactionKey } from "./messages/reactionInbox";

interface UseMessagesDomainParams {
  appOwnerId: string | null;
  chatForceScrollToBottomRef: React.MutableRefObject<boolean>;
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  conversations: ConversationsRepository;
  /** Background writes (legacy imports and migrations) wait until the account is hydrated. */
  hydrated: boolean;
  route: Route;
  unknownSenders: UnknownSendersRepository;
}

// removal gate in app/migrations/AGENTS.md
const MESSAGE_MIGRATION_VERSION = 1;

const toMessageStatus = (value: unknown): "pending" | "sent" =>
  trimString(value) === "pending" ? "pending" : "sent";

const migrationKeyForOwner = (ownerId: string): string =>
  `linky.messages_evolu_migrated_v${MESSAGE_MIGRATION_VERSION}:${ownerId}`;

const LEGACY_MESSAGES_KEY_PREFIX = `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.`;
const OVERLAY_KEY_INFIX = ".overlay.";

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

export const useMessagesDomain = ({
  appOwnerId,
  chatForceScrollToBottomRef,
  chatMessagesRef,
  conversations,
  hydrated,
  route,
  unknownSenders,
}: UseMessagesDomainParams) => {
  const activeChatRouteId =
    route.kind === "chat"
      ? route.id
      : route.kind === "bankPaymentOffer"
        ? route.chatId
        : null;
  // Null until the first read answers, so the legacy import below cannot
  // duplicate rows it has not seen yet.
  const loadedMessageRows = useAtomValue(messageRowsAtom);
  const nostrMessagesLocal = useAtomValue(localMessagesAtom);
  const normalizedReactionRows = useAtomValue(storedReactionsAtom);
  const nostrReactionsLocal = useAtomValue(localReactionsAtom);

  const chatWrites = useAtomSuspense(chatWritesAtom).value;
  const write = chatWrites.queueWrite;

  useUnknownSenderOverlayMigration({ appOwnerId, hydrated, unknownSenders });
  const {
    appendLocalNostrReaction,
    markLocalNostrMessageDeleted,
    removeLocalNostrMessagesByContactId,
    removeNostrReaction,
    softDeleteLocalNostrReaction,
    updateLocalNostrReaction,
  } = useMessageWrites({ conversations, unknownSenders });

  const knownReactionKeysRef = React.useRef<Set<string>>(new Set());
  const nostrReactionsLatestRef = useLatest(nostrReactionsLocal);

  React.useEffect(() => {
    chatWrites.syncLatestMessages(nostrMessagesLocal);
  }, [chatWrites, nostrMessagesLocal]);

  React.useEffect(() => {
    knownReactionKeysRef.current = new Set(normalizedReactionRows.seenKeys);
  }, [normalizedReactionRows]);

  const legacyImportDoneRef = React.useRef(false);

  React.useEffect(() => {
    if (!hydrated || loadedMessageRows === null || legacyImportDoneRef.current)
      return;
    legacyImportDoneRef.current = true;

    const existingMessages = dedupeNostrMessagesByPriority(nostrMessagesLocal);
    const seenWrapIds = new Set<string>();
    const seenClientKeys = new Set<string>();
    const seenRumorKeys = new Set<string>();
    for (const existingMessage of existingMessages) {
      const wrapId = trimString(existingMessage.wrapId);
      if (wrapId) seenWrapIds.add(wrapId);
      const clientKey = getLocalNostrMessageClientKey(existingMessage);
      if (clientKey) seenClientKeys.add(clientKey);
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
          const clientKey = getLocalNostrMessageClientKey(legacyMessage);
          const rumorKey = getLocalNostrMessageRumorKey(legacyMessage);
          if (wrapId && seenWrapIds.has(wrapId)) continue;
          if (clientKey && seenClientKeys.has(clientKey)) continue;
          if (rumorKey && seenRumorKeys.has(rumorKey)) continue;
          if (
            !chatWrites.storeMessage({
              ...legacyMessage,
              status: toMessageStatus(legacyMessage.status),
            })
          )
            continue;
          if (wrapId) seenWrapIds.add(wrapId);
          if (clientKey) seenClientKeys.add(clientKey);
          if (rumorKey) seenRumorKeys.add(rumorKey);
        }
        safeLocalStorageSet(migrationKey, "1");
      }
      safeLocalStorageRemove(storageKey);
    }
  }, [chatWrites, hydrated, loadedMessageRows, nostrMessagesLocal]);

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

  const scrollActiveChatToBottomRef = useLatest(scrollActiveChatToBottom);
  React.useEffect(
    () =>
      chatWrites.onMessageAppended((contactId) =>
        scrollActiveChatToBottomRef.current(contactId),
      ),
    [chatWrites, scrollActiveChatToBottomRef],
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

  const pendingPaymentsKey = pendingPaymentsKeyFor(appOwnerId);

  const { lastMessageByContactId, recentMessages: nostrMessagesRecent } =
    useAtomValue(messagesByContactAtom);
  const reactionsByMessageId = useAtomValue(reactionsByMessageIdAtom);
  const chatMessages = useAtomValue(chatMessagesAtom(activeChatRouteId));

  return {
    appendLocalNostrMessage: chatWrites.appendLocalNostrMessage,
    appendLocalNostrReaction,
    chatMessages,
    enqueuePendingPayment: chatWrites.enqueuePendingPayment,
    lastMessageByContactId,
    latestMessages: chatWrites.latestMessages,
    nostrMessagesLocal,
    nostrMessagesRecent,
    knownReactionKeysRef,
    markLocalNostrMessageDeleted,
    nostrReactionsLocal,
    pendingPaymentsKey,
    reactionsByMessageId,
    removeLocalNostrMessagesByContactId,
    softDeleteLocalNostrReaction,
    softDeleteLocalNostrReactionsByWrapIds,
    storeRetractedReaction,
    updateLocalNostrMessage: chatWrites.updateLocalNostrMessage,
    updateLocalNostrReaction,
  };
};
