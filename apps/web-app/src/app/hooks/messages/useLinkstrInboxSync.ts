import { Schema } from "effect";
import { decodeNpub, identityFromNsec, UnixSeconds } from "@linky/linkstr";
import type { InboxDelivery, WrapInboxEvent } from "@linky/linkstr";
import {
  useAtomMount,
  useAtomSet,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "@linky/linkstr-react";
import React from "react";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type {
  ContactNameRowLike,
  LocalNostrMessage,
  LocalNostrReaction,
  NewLocalNostrMessage,
  NewLocalNostrReaction,
  PaymentLogData,
  RouteWithOptionalId,
  UpdateLocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import {
  applyChatMessageReceived,
  applyOwnChatMessageConfirmed,
  type ChatInboxContext,
} from "./chatInbox";
import { buildUnknownContactId, normalizePubkeyHex } from "./contactIdentity";
import {
  handleBankOfferSnapshotReceived,
  handlePaymentNoticeReceived,
  notifyInsertedChatMessage,
  type InboxContact,
  type InboxNotificationsContext,
} from "./inboxNotifications";
import {
  createReactionInboxSessionState,
  processReactionInboxEvent,
  retryDeferredReactions,
  type ReactionInboxContext,
} from "./reactionInbox";
import {
  applyOwnSeenReceiptConfirmed,
  applySeenReceiptReceived,
  type PeerSeenWindow,
  type SeenReceiptInboxContext,
} from "./seenReceiptInbox";
import {
  getInitialNostrIdentitySource,
  getInitialNostrIdentitySwitchedAtSec,
  safeLocalStorageGetJson,
} from "../../../utils/storage";
import { trimString } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";

// Fallback backfill window for a first session without a persisted cursor.
const INBOX_BACKFILL_SINCE_SEC = 3 * 24 * 60 * 60;

const isBlockedPubkey = (pubkey: string): boolean => {
  const normalizedPubkey = normalizePubkeyHex(pubkey);
  if (!normalizedPubkey) return false;
  return safeLocalStorageGetJson(
    BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
    Schema.Array(Schema.String),
    [],
  )
    .map(normalizePubkeyHex)
    .filter((entry): entry is string => Boolean(entry))
    .includes(normalizedPubkey);
};

const deriveMyPubkey = (currentNsec: string | null): string | null => {
  if (!currentNsec) return null;
  return identityFromNsec(currentNsec.trim())?.pubkey ?? null;
};

type InboxContactRowLike = ContactNameRowLike & {
  npub?: string | null | undefined;
};

const buildContactIndex = (
  contacts: readonly InboxContactRowLike[],
): Map<string, InboxContact> => {
  const contactByPubkey = new Map<string, InboxContact>();
  // Archived contacts stay in the index: their incoming messages land on the
  // contact itself, which then restores it from the archive.
  for (const contact of contacts) {
    const npub = normalizeNpubIdentifier(contact.npub ?? "");
    if (!npub) continue;
    const pubkey = decodeNpub(npub);
    const id = trimString(contact.id);
    if (!pubkey || !id) continue;
    contactByPubkey.set(pubkey, {
      id,
      name: trimString(contact.name) || null,
      npub,
    });
  }
  return contactByPubkey;
};

interface UseLinkstrInboxSyncParams {
  advanceContactPeerSeen: (contactId: string, window: PeerSeenWindow) => void;
  appendLocalNostrMessage: (message: NewLocalNostrMessage) => string;
  appendLocalNostrReaction: (reaction: NewLocalNostrReaction) => string;
  bankPaymentOfferMessages: readonly LocalNostrMessage[];
  contacts: readonly InboxContactRowLike[];
  currentNsec: string | null;
  enabled: boolean;
  formatDisplayedAmountText: (amountSat: number) => string;
  getPeerSeenWindow: (contactId: string) => PeerSeenWindow | null;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  nostrMessagesLatestRef: React.MutableRefObject<LocalNostrMessage[]>;
  nostrMessagesLocal: readonly LocalNostrMessage[];
  nostrReactionWrapIdsRef: React.MutableRefObject<Set<string>>;
  nostrReactionsLocal: readonly LocalNostrReaction[];
  onBankPaymentOfferMessage: (message: LocalNostrMessage) => void;
  onOpenInboxMessageToast: (params: {
    contactId: string;
    messageId?: string;
  }) => void;
  pushToast: (message: string, options?: PushToastOptions) => void;
  recordSentSeenReceipt: (peerPubkey: string, seenUpToSec: number) => void;
  route: RouteWithOptionalId;
  softDeleteLocalNostrReactionsByWrapIds: (wrapIds: readonly string[]) => void;
  t: Translate;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  updateLocalNostrReaction: UpdateLocalNostrReaction;
}

export type DispatchInboxEvent = (
  event: WrapInboxEvent,
  delivery: InboxDelivery,
) => void;

/**
 * The app's single wrap-inbox consumer: applies every typed linkstr inbox
 * event — chat messages, own-message confirmations, reactions, payment
 * notices, bank-offer snapshots — to local state, and fires interruptions
 * (toasts, PWA notifications) for live deliveries only.
 */
export const useLinkstrInboxSync = (params: UseLinkstrInboxSyncParams) => {
  const setWrapInboxHandler = useAtomSet(wrapInboxHandlerAtom);
  useAtomMount(wrapInboxAtom);

  const { currentNsec, enabled, nostrMessagesLocal } = params;
  const myPubkey = React.useMemo(
    () => deriveMyPubkey(currentNsec),
    [currentNsec],
  );

  const reactionSessionStateRef = React.useRef(
    createReactionInboxSessionState(),
  );
  const identitySinceSecRef = React.useRef<number | null>(null);
  const contactIndexRef = React.useRef<{
    contacts: readonly InboxContactRowLike[] | null;
    index: Map<string, InboxContact>;
  }>({ contacts: null, index: new Map() });

  const paramsRef = React.useRef(params);
  React.useEffect(() => {
    paramsRef.current = params;
  });

  const buildHandlers = React.useCallback((myPubkeyHex: string) => {
    const latest = paramsRef.current;

    const findContact = (pubkey: string): InboxContact | null => {
      if (contactIndexRef.current.contacts !== paramsRef.current.contacts) {
        contactIndexRef.current = {
          contacts: paramsRef.current.contacts,
          index: buildContactIndex(paramsRef.current.contacts),
        };
      }
      const normalizedPubkey = normalizePubkeyHex(pubkey);
      return normalizedPubkey
        ? (contactIndexRef.current.index.get(normalizedPubkey) ?? null)
        : null;
    };

    const reactionCtx: ReactionInboxContext = {
      appendLocalNostrReaction: latest.appendLocalNostrReaction,
      identitySinceSec: identitySinceSecRef.current,
      isBlockedPubkey,
      knownReactionWrapIds: latest.nostrReactionWrapIdsRef.current,
      messages: latest.nostrMessagesLatestRef.current,
      myPubkey: myPubkeyHex,
      reactions: latest.nostrReactionsLocal,
      softDeleteLocalNostrReactionsByWrapIds:
        latest.softDeleteLocalNostrReactionsByWrapIds,
      state: reactionSessionStateRef.current,
      updateLocalNostrReaction: latest.updateLocalNostrReaction,
    };

    const chatCtx: ChatInboxContext = {
      appendLocalNostrMessage: latest.appendLocalNostrMessage,
      identitySinceSec: identitySinceSecRef.current,
      isBlockedPubkey,
      logPayStep: latest.logPayStep,
      messages: latest.nostrMessagesLatestRef.current,
      resolveContactId: (peerPubkey) => findContact(peerPubkey)?.id ?? null,
      updateLocalNostrMessage: latest.updateLocalNostrMessage,
    };

    const seenReceiptCtx: SeenReceiptInboxContext = {
      advanceContactPeerSeen: latest.advanceContactPeerSeen,
      findContactId: (peerPubkey) => findContact(peerPubkey)?.id ?? null,
      getPeerSeenWindow: latest.getPeerSeenWindow,
      identitySinceSec: identitySinceSecRef.current,
      isBlockedPubkey,
      nowSec: nowSeconds(),
      recordSentSeenReceipt: latest.recordSentSeenReceipt,
    };

    const notificationsCtx: InboxNotificationsContext = {
      bankPaymentOfferMessages: latest.bankPaymentOfferMessages,
      findContact,
      formatDisplayedAmountText: latest.formatDisplayedAmountText,
      maybeShowPwaNotification: latest.maybeShowPwaNotification,
      messages: latest.nostrMessagesLatestRef.current,
      onBankPaymentOfferMessage: latest.onBankPaymentOfferMessage,
      onOpenInboxMessageToast: latest.onOpenInboxMessageToast,
      pushToast: latest.pushToast,
      route: latest.route,
      t: latest.t,
    };

    return { chatCtx, notificationsCtx, reactionCtx, seenReceiptCtx };
  }, []);

  const dispatchInboxEvent = React.useCallback<DispatchInboxEvent>(
    (event, delivery) => {
      if (!enabled || myPubkey === null) return;
      const { chatCtx, notificationsCtx, reactionCtx, seenReceiptCtx } =
        buildHandlers(myPubkey);
      const cutoff = identitySinceSecRef.current;
      switch (event._tag) {
        case "ReactionAdded":
        case "OwnReactionConfirmed":
        case "ReactionRetracted":
        case "OwnRetractionConfirmed":
          processReactionInboxEvent(event, reactionCtx);
          return;
        case "ChatMessageReceived": {
          const inserted = applyChatMessageReceived(event, chatCtx);
          if (inserted && delivery === "live") {
            notifyInsertedChatMessage(inserted, notificationsCtx);
          }
          return;
        }
        case "OwnChatMessageConfirmed":
          applyOwnChatMessageConfirmed(event, chatCtx);
          return;
        case "PaymentNoticeReceived": {
          if (isBlockedPubkey(event.from)) return;
          if (cutoff !== null && event.sentAt < cutoff) return;
          const contactId =
            notificationsCtx.findContact(event.from)?.id ??
            buildUnknownContactId(event.from);
          if (!contactId) return;
          handlePaymentNoticeReceived(
            event,
            contactId,
            delivery,
            notificationsCtx,
          );
          return;
        }
        case "BankOfferSnapshotReceived":
        case "OwnBankOfferSnapshotConfirmed": {
          if (cutoff !== null && event.sentAt < cutoff) return;
          const isSelfAuthored = event._tag === "OwnBankOfferSnapshotConfirmed";
          const peerPubkey =
            event._tag === "OwnBankOfferSnapshotConfirmed"
              ? event.to
              : event.from;
          if (isBlockedPubkey(peerPubkey)) return;
          const contactId =
            notificationsCtx.findContact(peerPubkey)?.id ??
            buildUnknownContactId(peerPubkey);
          if (!contactId) return;
          handleBankOfferSnapshotReceived(
            event,
            {
              contactId,
              delivery,
              isOutgoing: event.offerer === myPubkey,
              isSelfAuthored,
              peerPubkey,
            },
            notificationsCtx,
          );
          return;
        }
        case "SeenReceiptReceived":
          applySeenReceiptReceived(event, seenReceiptCtx);
          return;
        case "OwnSeenReceiptConfirmed":
          applyOwnSeenReceiptConfirmed(event, seenReceiptCtx);
          return;
        case "WrapDropped":
          return;
      }
    },
    [buildHandlers, enabled, myPubkey],
  );

  React.useEffect(() => {
    if (!enabled || !currentNsec || myPubkey === null) return;
    reactionSessionStateRef.current = createReactionInboxSessionState();
    identitySinceSecRef.current =
      getInitialNostrIdentitySource() === "custom"
        ? getInitialNostrIdentitySwitchedAtSec()
        : null;

    // One handler object per identity session: a handler swap reopens the
    // relay subscriptions, so per-render state is reached through refs.
    // The cursor store (configured in useLinkstrConfigSync) wins over `since`
    // once it holds a checkpoint.
    setWrapInboxHandler({
      since: UnixSeconds.make(nowSeconds() - INBOX_BACKFILL_SINCE_SEC),
      onEvent: dispatchInboxEvent,
    });
    return () => setWrapInboxHandler(null);
  }, [currentNsec, dispatchInboxEvent, enabled, myPubkey, setWrapInboxHandler]);

  React.useEffect(() => {
    if (myPubkey === null) return;
    retryDeferredReactions(buildHandlers(myPubkey).reactionCtx);
  }, [buildHandlers, myPubkey, nostrMessagesLocal]);

  return dispatchInboxEvent;
};
