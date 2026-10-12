import { isRumorId, type Pubkey } from "@linky-fit/linkstr";
import {
  ContactId,
  createId,
  directConversationIdFor,
  MessageId,
  nostrMessageIdFor,
  RowNotFound,
  type ConversationsRepository,
  type UnknownSendersRepository,
} from "@linky-fit/linksync";
import { Duration, Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import { nowSeconds } from "../../../utils/time";
import { makeLocalId, trimString } from "../../../utils/validation";
import {
  isUnknownContactId,
  readUnknownContactIdPubkey,
} from "../../hooks/messages/contactIdentity";
import {
  dedupeNostrMessagesByPriority,
  getLocalNostrMessageClientKey,
} from "../../hooks/messages/messageHelpers";
import {
  localMessageFrom,
  toMessagePatch,
  toMessageWriteRow,
  toUnknownSenderWriteRow,
} from "../../hooks/messages/messageRows";
import { buildMessageUpdate } from "../../hooks/messages/messageUpdates";
import { enqueueStoredPendingPayment } from "../../lib/pendingPayments";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";
import type {
  AppendedRow,
  AppendLocalNostrMessage,
  LocalNostrMessage,
  NewLocalNostrMessage,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { sessionAtom, sessionSecrets } from "../session/session";
import {
  appOwnerIdAtom,
  conversationsRepositoryAtom,
  SessionSignedOut,
  unknownSendersRepositoryAtom,
} from "../session/store";

export interface PendingPaymentPayload {
  readonly amountSat: number;
  readonly contactId: ContactId;
  readonly recipientPubkey: Pubkey;
  readonly messageId?: string;
}

export interface StoredMessage {
  readonly message: LocalNostrMessage;
  readonly written: Promise<WriteOutcome>;
}

/** Local message writes, shared by the messaging hooks and the wallet commands. */
export interface ChatWrites {
  /** Stores a message unless the latest messages already hold it. */
  readonly appendLocalNostrMessage: AppendLocalNostrMessage;
  readonly updateLocalNostrMessage: UpdateLocalNostrMessage;
  /** Queues a payment made offline; the offline queue sends it once online. */
  readonly enqueuePendingPayment: (payload: PendingPaymentPayload) => void;
  /** Stores a message as it is, without checking for a stored copy; null when it is not storable. */
  readonly storeMessage: (
    message: NewLocalNostrMessage,
  ) => StoredMessage | null;
  /** Runs a message or reaction write after every write queued before it. */
  readonly queueWrite: (
    what: string,
    effect: Effect.Effect<void, unknown>,
  ) => Promise<WriteOutcome>;
  /** The last read of the stored messages plus what was appended since. */
  readonly latestMessages: () => readonly LocalNostrMessage[];
  /** Replaces the latest messages with a fresh read of the store. */
  readonly syncLatestMessages: (messages: readonly LocalNostrMessage[]) => void;
  /** Calls the listener with the contact id of every message appended from now on. */
  readonly onMessageAppended: (
    listener: (contactId: string) => void,
  ) => () => void;
}

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

/** The id every device gives a message from Nostr; null for a send that has no rumor yet. */
const nostrMessageIdOf = (message: NewLocalNostrMessage): MessageId | null => {
  const rumorId = trimString(message.rumorId);
  return isRumorId(rumorId) ? nostrMessageIdFor(rumorId) : null;
};

// Store calls are bounded on their own; a write can still wait on hydration.
const SLOW_CHAT_WRITE_MS = 10_000;
const MAX_CHAT_WRITE = Duration.seconds(60);

const reportChatWrite = (
  tag: "messages.queuedWriteSlow" | "messages.queuedWriteFailed",
  what: string,
  state: string,
): void => {
  console.warn(`[linky][messages] ${what} write ${state}`);
  reportAppLog({
    tag,
    summary: `A queued ${what} write ${state}`,
    payload: { what, state },
  });
};

export const pendingPaymentsKeyFor = (appOwnerId: string | null) =>
  appOwnerId
    ? `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${appOwnerId}`
    : null;

const makeChatWrites = ({
  appOwnerId,
  conversations,
  unknownSenders,
}: {
  readonly appOwnerId: string;
  readonly conversations: ConversationsRepository;
  readonly unknownSenders: UnknownSendersRepository;
}): ChatWrites => {
  // An update issued right after an insert (the send flow stamps the rumor
  // id on its pending row) must find the row.
  let writeQueue: Promise<void> = Promise.resolve();
  const queueWrite: ChatWrites["queueWrite"] = (what, effect) => {
    const outcome = writeQueue.then(() => {
      const slow = setTimeout(
        () =>
          reportChatWrite(
            "messages.queuedWriteSlow",
            what,
            "still running after 10 s",
          ),
        SLOW_CHAT_WRITE_MS,
      );
      return runWrite(
        Effect.timeoutOrElse(effect, {
          duration: MAX_CHAT_WRITE,
          orElse: () =>
            Effect.fail(new Error("did not finish within 60 s, abandoned")),
        }),
      ).finally(() => clearTimeout(slow));
    });
    writeQueue = outcome.then((settled) => {
      if (!settled.ok)
        reportChatWrite(
          "messages.queuedWriteFailed",
          what,
          `failed: ${settled.error}`,
        );
    });
    return outcome;
  };

  let latest: readonly LocalNostrMessage[] = [];
  const appendedListeners = new Set<(contactId: string) => void>();

  const insertNostrMessage = (
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
      written: queueWrite(
        "message",
        Effect.flatMap(conversations.ensureDirect(contactId), () =>
          conversations.messages.insertIfAbsent(row),
        ),
      ),
    };
  };

  const insertUnknownSenderMessage = (
    message: NewLocalNostrMessage,
    id: MessageId,
    wrapId: string,
  ): StoredMessage | null => {
    const peerPubkey = readUnknownContactIdPubkey(message.contactId);
    if (!peerPubkey) return null;
    const row = toUnknownSenderWriteRow(id, peerPubkey, message, wrapId);
    if (!row) return null;
    const written = queueWrite(
      "unknown sender message",
      Effect.flatMap(unknownSenders.insertIfAbsent(row), (stored) =>
        Effect.sync(() => {
          if (!stored) return;
          reportAppLog({
            tag: "unknownSenders.messageStored",
            summary: `Stored ${row.direction === "in" ? "a message from" : "a message to"} an unknown sender`,
            links: {
              message: id,
              pubkey: peerPubkey,
              ...(row.rumorId ? { rumor: row.rumorId } : {}),
            },
            payload: { direction: row.direction, status: row.status ?? null },
          });
        }),
      ),
    );
    return { message: localMessageFrom(message, id, wrapId), written };
  };

  const storeMessage: ChatWrites["storeMessage"] = (message) => {
    const id = nostrMessageIdOf(message) ?? createId<"Message">();
    const wrapId = trimString(message.wrapId) || `pending:${makeLocalId()}`;
    return isUnknownContactId(message.contactId)
      ? insertUnknownSenderMessage(message, id, wrapId)
      : insertNostrMessage(message, id, wrapId);
  };

  const appendLocalNostrMessage: AppendLocalNostrMessage = (message) => {
    const contactId = trimString(message.contactId);
    const direction = trimString(message.direction);
    const content = toText(message.content);
    if (!contactId || !direction || !content.trim()) return NOT_APPENDED;
    const wrapId = trimString(message.wrapId);
    const clientKey = getLocalNostrMessageClientKey(message);
    const rumorId = trimString(message.rumorId);

    const existing = latest.find((current) => {
      if (clientKey && getLocalNostrMessageClientKey(current) === clientKey)
        return true;
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
    // Messages arriving in one burst read this before the next store read.
    latest = dedupeNostrMessagesByPriority([...latest, stored.message]);
    for (const listener of appendedListeners) listener(contactId);
    return { id: stored.message.id, written: stored.written };
  };

  const updateLocalNostrMessage: UpdateLocalNostrMessage = (id, updates) => {
    const messageId = parseMessageId(trimString(id));
    if (!messageId) return NO_WRITE;
    return queueWrite(
      "message update",
      Effect.gen(function* () {
        const unknownSenderRow = yield* unknownSenders.byId(messageId);
        const repository =
          unknownSenderRow === null ? conversations.messages : unknownSenders;
        const current =
          unknownSenderRow ?? (yield* conversations.messages.byId(messageId));
        if (current === null)
          return yield* new RowNotFound({
            scope: "messages",
            table: "message",
            id: messageId,
          });
        const payload = buildMessageUpdate(messageId, updates, current);
        if (payload === null) return;
        yield* repository.update(messageId, toMessagePatch(payload));
      }),
    );
  };

  const pendingPaymentsKey = pendingPaymentsKeyFor(appOwnerId);
  const enqueuePendingPayment: ChatWrites["enqueuePendingPayment"] = (
    payload,
  ) => {
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
  };

  return {
    appendLocalNostrMessage,
    enqueuePendingPayment,
    latestMessages: () => latest,
    onMessageAppended: (listener) => {
      appendedListeners.add(listener);
      return () => {
        appendedListeners.delete(listener);
      };
    },
    queueWrite,
    storeMessage,
    syncLatestMessages: (messages) => {
      latest = messages;
    },
    updateLocalNostrMessage,
  };
};

/**
 * The message writes over the session's conversations, kept for the page: the
 * write queue and the latest messages outlive every screen. Signed out it
 * fails before reading the store, like `messagesCommandsAtom`.
 */
export const chatWritesAtom = Atom.keepAlive(
  Atom.readable((get) =>
    sessionSecrets(get(sessionAtom)) === null
      ? AsyncResult.fail(new SessionSignedOut())
      : AsyncResult.map(
          AsyncResult.all({
            appOwnerId: get(appOwnerIdAtom),
            conversations: get(conversationsRepositoryAtom),
            unknownSenders: get(unknownSendersRepositoryAtom),
          }),
          makeChatWrites,
        ),
  ),
);
