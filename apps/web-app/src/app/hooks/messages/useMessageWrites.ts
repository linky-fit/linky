import { isPubkey, isRumorId } from "@linky-fit/linkstr";
import {
  ContactId,
  createId,
  directConversationIdFor,
  MessageId,
  nostrReactionIdFor,
  ReactionId,
  RowNotFound,
  type ConversationsRepository,
  type UnknownSendersRepository,
} from "@linky-fit/linksync";
import { RegistryContext, useAtomSuspense } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { makeLocalId, trimString } from "../../../utils/validation";
import { NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";
import { chatWritesAtom } from "../../state/messages/chatWrites";
import {
  contactMessagesAtom,
  localReactionsAtom,
} from "../../state/messages/readModel";
import type {
  AppendedRow,
  AppendLocalNostrReaction,
  LocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import {
  isUnknownContactId,
  readUnknownContactIdPubkey,
} from "./contactIdentity";
import { toReactionPatch, toReactionWriteRow } from "./messageRows";
import { buildReactionUpdate } from "./messageUpdates";

const NOT_APPENDED: AppendedRow = { id: "", written: NO_WRITE };

const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

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

/** Reaction writes and message removals, queued with the other message writes. */
export const useMessageWrites = ({
  conversations,
  unknownSenders,
}: {
  readonly conversations: ConversationsRepository;
  readonly unknownSenders: UnknownSendersRepository;
}) => {
  const chatWrites = useAtomSuspense(chatWritesAtom).value;
  const write = chatWrites.queueWrite;
  // Read at call time, so screens that only write do not rerender on every message.
  const registry = React.useContext(RegistryContext);

  const removeNostrMessage = React.useCallback(
    (message: LocalNostrMessage): Promise<WriteOutcome> => {
      const messageId = parseMessageId(message.id);
      if (!messageId) return NO_WRITE;
      return write(
        "message removal",
        isUnknownContactId(message.contactId)
          ? unknownSenders.remove(messageId)
          : conversations.messages.remove(messageId),
      );
    },
    [conversations, unknownSenders, write],
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

  const appendLocalNostrReaction = React.useCallback<AppendLocalNostrReaction>(
    (reaction) => {
      const messageId = trimString(reaction.messageId);
      const reactorPubkey = trimString(reaction.reactorPubkey);
      const emoji = toText(reaction.emoji).trim();
      if (!messageId || !reactorPubkey || !emoji) return NOT_APPENDED;
      const wrapId = trimString(reaction.wrapId);
      const clientId = trimString(reaction.clientId);

      const existing = registry.get(localReactionsAtom).find((current) => {
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
      const target = chatWrites
        .latestMessages()
        .find((message) => trimString(message.rumorId) === messageId);
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
    [chatWrites, conversations, registry, write],
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

  const removeLocalNostrMessagesByContactId = React.useCallback(
    (contactId: string) => {
      const normalizedContactId = trimString(contactId);
      if (!normalizedContactId) return;
      const unknownPubkey = readUnknownContactIdPubkey(normalizedContactId);
      if (unknownPubkey) {
        void write(
          "unknown sender removal",
          Effect.flatMap(
            unknownSenders.removeSender(unknownPubkey),
            (removed) =>
              Effect.sync(() =>
                reportAppLog({
                  tag: "unknownSenders.removed",
                  summary: `Removed ${removed} messages of an unknown sender`,
                  links: { pubkey: unknownPubkey },
                  payload: { removed },
                }),
              ),
          ),
        );
        return;
      }
      for (const message of registry.get(contactMessagesAtom)) {
        if (trimString(message.contactId) !== normalizedContactId) continue;
        void removeNostrMessage(message);
      }
    },
    [registry, removeNostrMessage, unknownSenders, write],
  );

  return {
    appendLocalNostrReaction,
    removeLocalNostrMessagesByContactId,
    removeNostrMessage,
    removeNostrReaction,
    softDeleteLocalNostrReaction,
    updateLocalNostrReaction,
  };
};
