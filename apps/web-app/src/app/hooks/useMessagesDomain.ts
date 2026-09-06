import { Schema } from "effect";
import type { OwnerId } from "@evolu/common";
import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React from "react";
import { useLatest } from "../../hooks/useLatest";
import {
  applyMessageUpdate,
  buildMessageUpdate,
  buildReactionUpdate,
  type NostrMessageUpdatePayload,
  type NostrReactionUpdatePayload,
  type NostrMessageShadowState,
  type NostrReactionShadowState,
} from "./messages/messageUpdates";
import type { ContactId, NostrMessageRow, NostrReactionRow } from "../../evolu";
import { evolu, useEvolu } from "../../evolu";
import type { Route } from "../../types/route";
import {
  LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
import { isIdentityChangeMessageContent } from "../lib/identityChangeMessage";
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
import { UnknownRecord } from "../../utils/schema";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import {
  asNonEmptyString,
  makeLocalId,
  trimString,
} from "../../utils/validation";
import { nowSeconds } from "../../utils/time";

interface UseMessagesDomainParams {
  appOwnerId: OwnerId | null;
  appOwnerIdRef: React.MutableRefObject<OwnerId | null>;
  chatForceScrollToBottomRef: React.MutableRefObject<boolean>;
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  messagesOwnerId: OwnerId | null;
  messagesOwnerIdRef: React.MutableRefObject<OwnerId | null>;
  route: Route;
  visibleMessageOwnerIds: readonly string[];
}

const MESSAGE_MIGRATION_VERSION = 1;
const MESSAGE_RETENTION_PER_CONTACT = 500;
const MESSAGE_RETENTION_GLOBAL = 3000;
const REACTION_RETENTION_GLOBAL = 5000;
const RETENTION_PRUNE_THROTTLE_MS = 900;

const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toMessageStatus = (value: unknown): "pending" | "sent" => {
  const normalized = trimString(value);
  return normalized === "pending" ? "pending" : "sent";
};

const toReactionStatus = (value: unknown): "pending" | "sent" => {
  const normalized = trimString(value);
  return normalized === "pending" ? "pending" : "sent";
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const asNumber = Number(value ?? 0);
  if (!Number.isFinite(asNumber)) return fallback;
  const rounded = Math.trunc(asNumber);
  return rounded > 0 ? rounded : fallback;
};

const isSqliteTrueish = (value: unknown): boolean => {
  if (value === true || value === 1 || value === "1") return true;
  const normalized = trimString(value).toLowerCase();
  return normalized === "true";
};

const parseCreatedAtSec = (value: unknown): number =>
  toPositiveInt(value, Math.ceil(Date.now() / 1000));

const toLocalNostrMessage = (
  row: NostrMessageRow,
): LocalNostrMessage | null => {
  const id = trimString(row.id);
  const contactId = trimString(row.contactId);
  const directionRaw = trimString(row.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = toText(row.content);
  const wrapId = trimString(row.wrapId);

  if (!id || !contactId || !direction || !content.trim() || !wrapId) {
    return null;
  }

  const clientId = asNonEmptyString(row.clientId);
  const message: LocalNostrMessage = {
    id,
    contactId,
    direction,
    content,
    wrapId,
    rumorId: asNonEmptyString(row.rumorId),
    pubkey: trimString(row.pubkey),
    createdAtSec: parseCreatedAtSec(row.createdAtSec),
    status: toMessageStatus(row.status),
    localOnly: isSqliteTrueish(row.localOnly),
    replyToId: asNonEmptyString(row.replyToId),
    replyToContent: asNonEmptyString(row.replyToContent),
    rootMessageId: asNonEmptyString(row.rootMessageId),
    editedAtSec:
      row.editedAtSec === null || row.editedAtSec === undefined
        ? null
        : parseCreatedAtSec(row.editedAtSec),
    editedFromId: asNonEmptyString(row.editedFromId),
    isEdited: isSqliteTrueish(row.isEdited),
    originalContent: asNonEmptyString(row.originalContent),
    ...(clientId ? { clientId } : {}),
  };

  return message;
};

const toLocalNostrReaction = (
  row: NostrReactionRow,
): LocalNostrReaction | null => {
  const id = trimString(row.id);
  const messageId = trimString(row.messageId);
  const reactorPubkey = trimString(row.reactorPubkey);
  const emoji = toText(row.emoji).trim();
  const wrapId = trimString(row.wrapId);

  if (!id || !messageId || !reactorPubkey || !emoji || !wrapId) return null;

  const clientId = asNonEmptyString(row.clientId);
  return {
    id,
    messageId,
    reactorPubkey,
    emoji,
    wrapId,
    createdAtSec: parseCreatedAtSec(row.createdAtSec),
    status: toReactionStatus(row.status),
    ...(clientId ? { clientId } : {}),
  };
};

const normalizeLegacyLocalMessage = (
  row: Record<string, unknown>,
): LocalNostrMessage | null => {
  const contactId = trimString(row.contactId);
  const directionRaw = trimString(row.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = toText(row.content);
  const wrapId = trimString(row.wrapId) || `legacy:${makeLocalId()}`;

  if (!contactId || !direction || !content.trim()) return null;

  const clientId = asNonEmptyString(row.clientId);
  return {
    id: trimString(row.id) || makeLocalId(),
    contactId,
    direction,
    content,
    wrapId,
    rumorId: asNonEmptyString(row.rumorId),
    pubkey: trimString(row.pubkey),
    createdAtSec: toPositiveInt(row.createdAtSec, Math.ceil(Date.now() / 1000)),
    status: toMessageStatus(row.status),
    localOnly: Boolean(row.localOnly),
    replyToId: asNonEmptyString(row.replyToId),
    replyToContent: asNonEmptyString(row.replyToContent),
    rootMessageId: asNonEmptyString(row.rootMessageId),
    editedAtSec: row.editedAtSec
      ? toPositiveInt(row.editedAtSec, Math.ceil(Date.now() / 1000))
      : null,
    editedFromId: asNonEmptyString(row.editedFromId),
    isEdited: Boolean(row.isEdited),
    originalContent: asNonEmptyString(row.originalContent),
    ...(clientId ? { clientId } : {}),
  };
};

type NostrMessageInsertPayload = {
  contactId: string;
  content: string;
  createdAtSec: number;
  direction: "in" | "out";
  status: "pending" | "sent";
  wrapId: string;
  clientId?: string;
  editedAtSec?: number;
  editedFromId?: string;
  isEdited?: "1";
  localOnly?: "1";
  originalContent?: string;
  pubkey?: string;
  replyToContent?: string;
  replyToId?: string;
  rootMessageId?: string;
  rumorId?: string;
};

const localMessageFromInsertPayload = (
  id: string,
  payload: NostrMessageInsertPayload,
): LocalNostrMessage => {
  const message: LocalNostrMessage = {
    id,
    contactId: payload.contactId,
    direction: payload.direction,
    content: payload.content,
    wrapId: payload.wrapId,
    rumorId: payload.rumorId ?? null,
    pubkey: payload.pubkey ?? "",
    createdAtSec: payload.createdAtSec,
    status: payload.status,
    localOnly: payload.localOnly === "1",
    replyToId: payload.replyToId ?? null,
    replyToContent: payload.replyToContent ?? null,
    rootMessageId: payload.rootMessageId ?? null,
    editedAtSec: payload.editedAtSec ?? null,
    editedFromId: payload.editedFromId ?? null,
    isEdited: payload.isEdited === "1",
    originalContent: payload.originalContent ?? null,
  };

  if (payload.clientId) message.clientId = payload.clientId;

  return message;
};

const buildMessageInsertPayload = (
  message: NewLocalNostrMessage,
): NostrMessageInsertPayload | null => {
  const contactId = trimString(message.contactId);
  const directionRaw = trimString(message.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = toText(message.content);
  if (!contactId || !direction || !content.trim()) return null;

  const wrapId = trimString(message.wrapId) || `pending:${makeLocalId()}`;
  const createdAtSec = toPositiveInt(
    message.createdAtSec,
    Math.ceil(Date.now() / 1000),
  );
  const editedAtSec = message.editedAtSec
    ? toPositiveInt(message.editedAtSec, createdAtSec)
    : null;

  const payload: NostrMessageInsertPayload = {
    contactId,
    direction,
    content,
    wrapId,
    createdAtSec,
    status: toMessageStatus(message.status),
  };

  const rumorId = asNonEmptyString(message.rumorId);
  if (rumorId) payload.rumorId = rumorId;

  const pubkey = asNonEmptyString(message.pubkey);
  if (pubkey) payload.pubkey = pubkey;

  const clientId = asNonEmptyString(message.clientId);
  if (clientId) payload.clientId = clientId;

  if (message.localOnly) payload.localOnly = "1";

  const replyToId = asNonEmptyString(message.replyToId);
  if (replyToId) payload.replyToId = replyToId;

  const replyToContent = asNonEmptyString(message.replyToContent);
  if (replyToContent) payload.replyToContent = replyToContent;

  const rootMessageId = asNonEmptyString(message.rootMessageId);
  if (rootMessageId) payload.rootMessageId = rootMessageId;

  if (editedAtSec) payload.editedAtSec = editedAtSec;

  const editedFromId = asNonEmptyString(message.editedFromId);
  if (editedFromId) payload.editedFromId = editedFromId;

  if (message.isEdited) payload.isEdited = "1";

  const originalContent = asNonEmptyString(message.originalContent);
  if (originalContent) payload.originalContent = originalContent;

  return payload;
};

const buildReactionInsertPayload = (
  reaction: NewLocalNostrReaction,
): {
  createdAtSec: number;
  emoji: string;
  messageId: string;
  reactorPubkey: string;
  status: "pending" | "sent";
  wrapId: string;
  clientId?: string;
} | null => {
  const messageId = trimString(reaction.messageId);
  const reactorPubkey = trimString(reaction.reactorPubkey);
  const emoji = toText(reaction.emoji).trim();
  if (!messageId || !reactorPubkey || !emoji) return null;

  const wrapId = trimString(reaction.wrapId) || `pending:${makeLocalId()}`;

  const payload: {
    createdAtSec: number;
    emoji: string;
    messageId: string;
    reactorPubkey: string;
    status: "pending" | "sent";
    wrapId: string;
    clientId?: string;
  } = {
    messageId,
    reactorPubkey,
    emoji,
    createdAtSec: toPositiveInt(
      reaction.createdAtSec,
      Math.ceil(Date.now() / 1000),
    ),
    wrapId,
    status: toReactionStatus(reaction.status),
  };

  const clientId = asNonEmptyString(reaction.clientId);
  if (clientId) payload.clientId = clientId;

  return payload;
};

const migrationKeyForOwner = (ownerId: string): string =>
  `linky.messages_evolu_migrated_v${MESSAGE_MIGRATION_VERSION}:${ownerId}`;

const overlayMessagesKeyForOwner = (ownerId: string): string =>
  `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.overlay.${ownerId}`;

export const useMessagesDomain = ({
  appOwnerId,
  appOwnerIdRef,
  chatForceScrollToBottomRef,
  chatMessagesRef,
  messagesOwnerId,
  messagesOwnerIdRef,
  route,
  visibleMessageOwnerIds,
}: UseMessagesDomainParams) => {
  const { insert, update } = useEvolu();
  const activeChatRouteId =
    route.kind === "chat"
      ? route.id
      : route.kind === "bankPaymentOffer"
        ? route.chatId
        : null;
  const [overlayMessages, setOverlayMessages] = React.useState<
    LocalNostrMessage[]
  >([]);

  const nostrMessagesQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrMessage")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue)
          .orderBy("createdAtSec", "asc")
          .orderBy("createdAt", "asc"),
      ),
    [],
  );

  const nostrReactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrReaction")
          .selectAll()
          .orderBy("createdAtSec", "asc")
          .orderBy("createdAt", "asc"),
      ),
    [],
  );

  const nostrMessageRows = useQuery(nostrMessagesQuery);
  const nostrReactionRows = useQuery(nostrReactionsQuery);

  const visibleMessageOwnerIdsSet = React.useMemo(() => {
    const ids = visibleMessageOwnerIds
      .map((ownerId) => trimString(ownerId))
      .filter(Boolean);
    return new Set(ids);
  }, [visibleMessageOwnerIds]);

  const isVisibleMessageOwner = React.useCallback(
    (row: Pick<NostrMessageRow, "ownerId">) => {
      if (visibleMessageOwnerIdsSet.size === 0) return true;
      const ownerId = trimString(row.ownerId);
      if (!ownerId) return false;
      return visibleMessageOwnerIdsSet.has(ownerId);
    },
    [visibleMessageOwnerIdsSet],
  );

  const normalizedReactionRows = React.useMemo(() => {
    const deletedWrapIds = new Set<string>();
    const seenWrapIds = new Set<string>();
    const reactions: LocalNostrReaction[] = [];
    for (const row of nostrReactionRows) {
      if (!isVisibleMessageOwner(row)) continue;
      const wrapId = trimString(row.wrapId);
      if (wrapId) seenWrapIds.add(wrapId);
      if (isSqliteTrueish(row.isDeleted)) {
        if (wrapId) deletedWrapIds.add(wrapId);
        continue;
      }
      const normalized = toLocalNostrReaction(row);
      if (normalized) reactions.push(normalized);
    }
    return { deletedWrapIds, reactions, seenWrapIds };
  }, [isVisibleMessageOwner, nostrReactionRows]);

  const normalizedMessageRows = React.useMemo(() => {
    const parsed: LocalNostrMessage[] = [];
    for (const row of nostrMessageRows) {
      if (!isVisibleMessageOwner(row)) continue;
      const normalized = toLocalNostrMessage(row);
      if (normalized) parsed.push(normalized);
    }
    return parsed;
  }, [isVisibleMessageOwner, nostrMessageRows]);

  const evoluNostrMessagesLocal = React.useMemo(() => {
    const deduped = dedupeNostrMessagesByPriority(normalizedMessageRows);
    return deduped.sort((a, b) => a.createdAtSec - b.createdAtSec);
  }, [normalizedMessageRows]);

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
      .map((message) => normalizeLegacyLocalMessage(message))
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

  const insertNostrMessage = React.useCallback(
    (payload: NostrMessageInsertPayload) => {
      const result = messagesOwnerId
        ? insert("nostrMessage", payload, { ownerId: messagesOwnerId })
        : insert("nostrMessage", payload);
      return result;
    },
    [insert, messagesOwnerId],
  );

  const insertNostrReaction = React.useCallback(
    (payload: NonNullable<ReturnType<typeof buildReactionInsertPayload>>) => {
      const result = messagesOwnerId
        ? insert("nostrReaction", payload, { ownerId: messagesOwnerId })
        : insert("nostrReaction", payload);
      return result;
    },
    [insert, messagesOwnerId],
  );

  const buildVisibleRowOwnerIdsById = React.useCallback(
    (rows: readonly (NostrMessageRow | NostrReactionRow)[]) => {
      const ownerIdsById = new Map<string, OwnerId[]>();
      for (const row of rows) {
        if (!isVisibleMessageOwner(row)) continue;
        const id = trimString(row.id);
        if (!id) continue;
        const ownerId = row.ownerId;
        if (!ownerId) continue;
        const existing = ownerIdsById.get(id);
        if (!existing) {
          ownerIdsById.set(id, [ownerId]);
          continue;
        }
        if (!existing.some((candidate) => candidate === ownerId)) {
          existing.push(ownerId);
        }
      }
      return ownerIdsById;
    },
    [isVisibleMessageOwner],
  );
  const nostrMessageOwnerIdsById = React.useMemo(
    () => buildVisibleRowOwnerIdsById(nostrMessageRows),
    [buildVisibleRowOwnerIdsById, nostrMessageRows],
  );
  const nostrReactionOwnerIdsById = React.useMemo(
    () => buildVisibleRowOwnerIdsById(nostrReactionRows),
    [buildVisibleRowOwnerIdsById, nostrReactionRows],
  );

  const updateNostrMessage = React.useCallback(
    (payload: NostrMessageUpdatePayload) => {
      const rowOwnerIds =
        nostrMessageOwnerIdsById.get(trimString(payload.id)) ?? [];
      if (rowOwnerIds.length > 0) {
        for (const ownerId of rowOwnerIds) {
          update("nostrMessage", payload, { ownerId });
        }
        return;
      }

      if (messagesOwnerId)
        update("nostrMessage", payload, { ownerId: messagesOwnerId });
      else update("nostrMessage", payload);
    },
    [messagesOwnerId, nostrMessageOwnerIdsById, update],
  );

  const updateNostrReaction = React.useCallback(
    (payload: NostrReactionUpdatePayload) => {
      const rowOwnerIds =
        nostrReactionOwnerIdsById.get(trimString(payload.id)) ?? [];
      if (rowOwnerIds.length > 0) {
        for (const ownerId of rowOwnerIds) {
          update("nostrReaction", payload, { ownerId });
        }
        return;
      }

      if (messagesOwnerId)
        update("nostrReaction", payload, { ownerId: messagesOwnerId });
      else update("nostrReaction", payload);
    },
    [messagesOwnerId, nostrReactionOwnerIdsById, update],
  );

  const [pendingPayments, setPendingPayments] = React.useState<
    LocalPendingPayment[]
  >(() => []);

  const migrationRunningRef = React.useRef(false);
  const migrationDoneForOwnerRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!messagesOwnerId) return;
    const ownerKey = trimString(messagesOwnerId);
    if (!ownerKey) return;
    if (migrationRunningRef.current) return;
    if (migrationDoneForOwnerRef.current === ownerKey) return;

    const migrationKey = migrationKeyForOwner(ownerKey);
    if (safeLocalStorageGet(migrationKey) === "1") {
      migrationDoneForOwnerRef.current = ownerKey;
      return;
    }

    migrationRunningRef.current = true;
    try {
      const normalizedLegacy = safeLocalStorageGetJson(
        `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.${ownerKey}`,
        Schema.Array(UnknownRecord),
        [],
      )
        .map((message) => normalizeLegacyLocalMessage(message))
        .filter((message): message is LocalNostrMessage => Boolean(message));

      const dedupedLegacy = dedupeNostrMessagesByPriority(normalizedLegacy);
      const existingMessages =
        dedupeNostrMessagesByPriority(nostrMessagesLocal);

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

      for (const legacyMessage of dedupedLegacy) {
        const wrapId = trimString(legacyMessage.wrapId);
        const clientId = trimString(legacyMessage.clientId);
        const rumorKey = getLocalNostrMessageRumorKey(legacyMessage);

        if (wrapId && seenWrapIds.has(wrapId)) continue;
        if (clientId && seenClientIds.has(clientId)) continue;
        if (rumorKey && seenRumorKeys.has(rumorKey)) continue;

        const payload = buildMessageInsertPayload({
          ...legacyMessage,
          status: toMessageStatus(legacyMessage.status),
        });
        if (!payload) continue;

        const result = insertNostrMessage(payload);
        if (!result.ok) continue;

        if (wrapId) seenWrapIds.add(wrapId);
        if (clientId) seenClientIds.add(clientId);
        if (rumorKey) seenRumorKeys.add(rumorKey);
      }

      safeLocalStorageSet(migrationKey, "1");
      safeLocalStorageRemove(
        `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.${ownerKey}`,
      );
      migrationDoneForOwnerRef.current = ownerKey;
    } finally {
      migrationRunningRef.current = false;
    }
  }, [
    insertNostrMessage,
    messagesOwnerId,
    evoluNostrMessagesLocal,
    nostrMessagesLocal,
  ]);

  const appendLocalNostrMessage = React.useCallback(
    (message: NewLocalNostrMessage): string => {
      const payload = buildMessageInsertPayload(message);
      if (!payload) return "";

      const existing = nostrMessagesLatestRef.current.find((current) => {
        const sameClientId =
          payload.clientId &&
          trimString(current.clientId) === trimString(payload.clientId);
        if (sameClientId) return true;

        const sameWrapId =
          trimString(current.wrapId) === trimString(payload.wrapId);
        if (sameWrapId) return true;

        const sameRumor =
          payload.rumorId &&
          trimString(current.rumorId) === trimString(payload.rumorId);
        if (sameRumor) return true;

        return (
          trimString(current.contactId) === trimString(payload.contactId) &&
          trimString(current.direction) === trimString(payload.direction) &&
          toText(current.content) === toText(payload.content) &&
          current.createdAtSec === payload.createdAtSec
        );
      });
      if (existing) return trimString(existing.id);

      if (isUnknownContactId(payload.contactId)) {
        const messageId = makeLocalId();
        const nextMessage = localMessageFromInsertPayload(messageId, payload);
        const nextOverlayMessages = dedupeNostrMessagesByPriority([
          ...overlayMessagesRef.current,
          nextMessage,
        ]).sort((a, b) => a.createdAtSec - b.createdAtSec);
        persistOverlayMessages(nextOverlayMessages);

        if (
          activeChatRouteId &&
          trimString(message.contactId) === trimString(activeChatRouteId)
        ) {
          chatForceScrollToBottomRef.current = true;
          requestAnimationFrame(() => {
            const container = chatMessagesRef.current;
            if (container) container.scrollTop = container.scrollHeight;
          });
        }

        return messageId;
      }

      const result = insertNostrMessage(payload);
      if (!result.ok) return "";

      const messageId = toText(result.value.id);
      const insertedMessage = localMessageFromInsertPayload(messageId, payload);
      nostrMessagesLatestRef.current = dedupeNostrMessagesByPriority([
        ...nostrMessagesLatestRef.current,
        insertedMessage,
      ]);
      nostrMessageWrapIdsRef.current.add(payload.wrapId);

      if (
        activeChatRouteId &&
        trimString(message.contactId) === trimString(activeChatRouteId)
      ) {
        chatForceScrollToBottomRef.current = true;
        requestAnimationFrame(() => {
          const container = chatMessagesRef.current;
          if (container) container.scrollTop = container.scrollHeight;
        });
      }

      return messageId;
    },
    [
      overlayMessagesRef,
      activeChatRouteId,
      chatForceScrollToBottomRef,
      chatMessagesRef,
      insertNostrMessage,
      persistOverlayMessages,
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
        const nextOverlayMessages = overlayMessagesRef.current.map(
          (message) => {
            if (trimString(message.id) !== normalizedId) return message;
            return applyMessageUpdate(message, payload);
          },
        );
        persistOverlayMessages(nextOverlayMessages);
        return;
      }

      updateNostrMessage(payload);
    },
    [overlayMessagesRef, persistOverlayMessages, updateNostrMessage],
  );

  const appendLocalNostrReaction = React.useCallback(
    (reaction: NewLocalNostrReaction): string => {
      const payload = buildReactionInsertPayload(reaction);
      if (!payload) return "";

      const existing = nostrReactionsLatestRef.current.find((current) => {
        const sameClientId =
          payload.clientId &&
          trimString(current.clientId) === trimString(payload.clientId);
        if (sameClientId) return true;

        const sameWrapId =
          trimString(current.wrapId) === trimString(payload.wrapId);
        if (sameWrapId) return true;

        return (
          trimString(current.messageId) === trimString(payload.messageId) &&
          trimString(current.reactorPubkey) ===
            trimString(payload.reactorPubkey) &&
          trimString(current.emoji) === trimString(payload.emoji) &&
          current.createdAtSec === payload.createdAtSec
        );
      });
      if (existing) return trimString(existing.id);

      const result = insertNostrReaction(payload);
      if (!result.ok) return "";
      return toText(result.value.id);
    },
    [nostrReactionsLatestRef, insertNostrReaction],
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

      updateNostrReaction(payload);
    },
    [nostrReactionsLatestRef, updateNostrReaction],
  );

  const softDeleteLocalNostrReaction = React.useCallback(
    (id: string) => {
      const normalizedId = trimString(id);
      if (!normalizedId) return;
      updateNostrReaction({
        id: normalizedId,
        isDeleted: Evolu.sqliteTrue,
      });
    },
    [updateNostrReaction],
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
        updateNostrReaction({
          id: reaction.id,
          isDeleted: Evolu.sqliteTrue,
        });
      }
    },
    [nostrReactionsLatestRef, updateNostrReaction],
  );

  const reassignLocalNostrMessagesContactId = React.useCallback(
    (fromContactId: string, toContactId: string) => {
      const normalizedFrom = trimString(fromContactId);
      const normalizedTo = trimString(toContactId);
      if (!normalizedFrom || !normalizedTo) return 0;

      const movedMessageIds = new Set<string>();
      const targetIsUnknown = isUnknownContactId(normalizedTo);
      const nextOverlayMessages: LocalNostrMessage[] = [];

      for (const message of overlayMessagesRef.current) {
        if (trimString(message.contactId) !== normalizedFrom) {
          nextOverlayMessages.push(message);
          continue;
        }

        movedMessageIds.add(trimString(message.id));
        const movedMessage = { ...message, contactId: normalizedTo };

        if (targetIsUnknown) {
          nextOverlayMessages.push(movedMessage);
          continue;
        }

        const payload = buildMessageInsertPayload(movedMessage);
        const result = payload ? insertNostrMessage(payload) : null;
        if (!result?.ok) nextOverlayMessages.push(movedMessage);
      }

      if (targetIsUnknown) {
        for (const message of nostrMessagesLatestRef.current) {
          if (trimString(message.contactId) !== normalizedFrom) continue;
          const id = trimString(message.id);
          if (!id) continue;
          movedMessageIds.add(id);
          nextOverlayMessages.push({
            ...message,
            contactId: normalizedTo,
          });
          updateNostrMessage({ id, isDeleted: Evolu.sqliteTrue });
        }
      }

      for (const row of nostrMessageRows) {
        if (!isVisibleMessageOwner(row)) continue;
        if (trimString(row.contactId) !== normalizedFrom) continue;
        const id = trimString(row.id);
        if (!id) continue;
        movedMessageIds.add(id);

        if (targetIsUnknown) {
          const message = toLocalNostrMessage(row);
          if (message) {
            nextOverlayMessages.push({
              ...message,
              contactId: normalizedTo,
            });
          }
          updateNostrMessage({ id, isDeleted: Evolu.sqliteTrue });
          continue;
        }

        updateNostrMessage({ id, contactId: normalizedTo });
      }

      persistOverlayMessages(
        dedupeNostrMessagesByPriority(nextOverlayMessages).sort(
          (a, b) => a.createdAtSec - b.createdAtSec,
        ),
      );

      return movedMessageIds.size;
    },
    [
      overlayMessagesRef,
      insertNostrMessage,
      isVisibleMessageOwner,
      nostrMessageRows,
      persistOverlayMessages,
      updateNostrMessage,
    ],
  );

  const removeLocalNostrMessagesByContactId = React.useCallback(
    (contactId: string) => {
      const normalizedContactId = trimString(contactId);
      if (!normalizedContactId) return;
      const nextOverlayMessages = overlayMessagesRef.current.filter(
        (message) => trimString(message.contactId) !== normalizedContactId,
      );
      persistOverlayMessages(nextOverlayMessages);

      for (const row of nostrMessageRows) {
        if (!isVisibleMessageOwner(row)) continue;
        if (trimString(row.contactId) !== normalizedContactId) continue;
        const id = trimString(row.id);
        if (!id) continue;
        updateNostrMessage({ id, isDeleted: Evolu.sqliteTrue });
      }
    },
    [
      overlayMessagesRef,
      isVisibleMessageOwner,
      nostrMessageRows,
      persistOverlayMessages,
      updateNostrMessage,
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
        updateNostrMessage({ id: messageId, isDeleted: Evolu.sqliteTrue });
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
        updateNostrReaction({
          id: reactionId,
          isDeleted: Evolu.sqliteTrue,
        });
      }
    } finally {
      retentionPruneInFlightRef.current = false;
    }
  }, [
    overlayMessagesRef,
    nostrMessagesLocal,
    nostrReactionsLocal,
    persistOverlayMessages,
    updateNostrMessage,
    updateNostrReaction,
  ]);

  React.useEffect(() => {
    messagesOwnerIdRef.current = messagesOwnerId;
  }, [messagesOwnerId, messagesOwnerIdRef]);

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

    const normalized = safeLocalStorageGetJson(
      `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${ownerId}`,
      Schema.Array(UnknownRecord),
      [],
    )
      .map((pendingPayment) => ({
        id: trimString(pendingPayment.id),
        contactId: trimString(pendingPayment.contactId),
        amountSat: Math.max(
          0,
          Math.trunc(Number(pendingPayment.amountSat ?? 0) || 0),
        ),
        createdAtSec: Math.max(
          0,
          Math.trunc(Number(pendingPayment.createdAtSec ?? 0) || 0),
        ),
        ...(pendingPayment.messageId
          ? { messageId: toText(pendingPayment.messageId) }
          : {}),
      }))
      .filter(
        (pendingPayment) =>
          pendingPayment.id &&
          pendingPayment.contactId &&
          pendingPayment.amountSat > 0,
      );

    setPendingPayments(normalized);
  }, [appOwnerId, appOwnerIdRef]);

  const enqueuePendingPayment = React.useCallback(
    (payload: {
      amountSat: number;
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
