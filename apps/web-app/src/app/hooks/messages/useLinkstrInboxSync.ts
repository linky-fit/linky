import { reportAppLog } from "../../../devtools/inspector/appLog";
import { identityFromNsec, UnixSeconds } from "@linky-fit/linkstr";
import type {
  BankOfferInboxEvent,
  InboxDelivery,
  Pubkey,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import type { AppliedBankPaymentOfferSnapshot } from "@linky-fit/proxy-payment";
import {
  useAtomMount,
  useAtomSet,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "@linky-fit/linkstr-react";
import React from "react";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { isBlockedPubkey } from "../../lib/blockList";
import type {
  AppendLocalNostrMessage,
  AppendLocalNostrReaction,
  LocalNostrMessage,
  LocalNostrReaction,
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
  buildContactIndex,
  type InboxContactRowLike,
} from "./inboxContactIndex";
import {
  notifyBankOfferSnapshot,
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
} from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
import { allWrites, NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";
import type { Translate } from "../../../i18n";

// Fallback backfill window for a first session without a persisted cursor.
const INBOX_BACKFILL_SINCE_SEC = 3 * 24 * 60 * 60;

const deriveMyPubkey = (currentNsec: string | null): Pubkey | null => {
  if (!currentNsec) return null;
  return identityFromNsec(currentNsec.trim())?.pubkey ?? null;
};

interface UseLinkstrInboxSyncParams {
  advanceContactPeerSeen: SeenReceiptInboxContext["advanceContactPeerSeen"];
  appendLocalNostrMessage: AppendLocalNostrMessage;
  appendLocalNostrReaction: AppendLocalNostrReaction;
  applyBankPaymentOfferSnapshot: (
    event: BankOfferInboxEvent,
  ) => readonly AppliedBankPaymentOfferSnapshot[];
  contacts: readonly InboxContactRowLike[];
  currentNsec: string | null;
  enabled: boolean;
  formatDisplayedAmountText: (amountSat: number) => string;
  getPeerSeenWindow: (contactId: string) => PeerSeenWindow | null;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  /** See `ChatInboxContext.visibleSinceSec`. */
  messagesVisibleSinceSec: number | null;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  nostrMessagesLatestRef: React.MutableRefObject<LocalNostrMessage[]>;
  nostrMessagesLocal: readonly LocalNostrMessage[];
  knownReactionKeysRef: React.MutableRefObject<Set<string>>;
  nostrReactionsLocal: readonly LocalNostrReaction[];
  onOpenInboxMessageToast: (params: {
    contactId: string;
    messageId?: string;
  }) => void;
  pushToast: (message: string, options?: PushToastOptions) => void;
  recordSentSeenReceipt: (peerPubkey: string, seenUpToSec: number) => void;
  route: RouteWithOptionalId;
  softDeleteLocalNostrReactionsByWrapIds: ReactionInboxContext["softDeleteLocalNostrReactionsByWrapIds"];
  storeRetractedReaction: ReactionInboxContext["storeRetractedReaction"];
  t: Translate;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  updateLocalNostrReaction: UpdateLocalNostrReaction;
}

/** Handles an inbox event; resolves once everything it stored is written. */
export type DispatchInboxEvent = (
  event: WrapInboxEvent,
  delivery: InboxDelivery,
) => Promise<WriteOutcome>;

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

  const buildHandlers = React.useCallback((myPubkeyHex: Pubkey) => {
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
      knownReactionKeys: latest.knownReactionKeysRef.current,
      messages: latest.nostrMessagesLatestRef.current,
      myPubkey: myPubkeyHex,
      reactions: latest.nostrReactionsLocal,
      softDeleteLocalNostrReactionsByWrapIds:
        latest.softDeleteLocalNostrReactionsByWrapIds,
      state: reactionSessionStateRef.current,
      storeRetractedReaction: latest.storeRetractedReaction,
      updateLocalNostrReaction: latest.updateLocalNostrReaction,
      visibleSinceSec: latest.messagesVisibleSinceSec,
    };

    const chatCtx: ChatInboxContext = {
      appendLocalNostrMessage: latest.appendLocalNostrMessage,
      identitySinceSec: identitySinceSecRef.current,
      isBlockedPubkey,
      logPayStep: latest.logPayStep,
      messages: latest.nostrMessagesLatestRef.current,
      resolveContactId: (peerPubkey) => findContact(peerPubkey)?.id ?? null,
      updateLocalNostrMessage: latest.updateLocalNostrMessage,
      visibleSinceSec: latest.messagesVisibleSinceSec,
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
      findContact,
      formatDisplayedAmountText: latest.formatDisplayedAmountText,
      maybeShowPwaNotification: latest.maybeShowPwaNotification,
      messages: latest.nostrMessagesLatestRef.current,
      onOpenInboxMessageToast: latest.onOpenInboxMessageToast,
      pushToast: latest.pushToast,
      route: latest.route,
      t: latest.t,
    };

    return { chatCtx, notificationsCtx, reactionCtx, seenReceiptCtx };
  }, []);

  const dispatchInboxEvent = React.useCallback<DispatchInboxEvent>(
    (event, delivery) => {
      if (!enabled || myPubkey === null) return NO_WRITE;
      const { chatCtx, notificationsCtx, reactionCtx, seenReceiptCtx } =
        buildHandlers(myPubkey);
      const cutoff = identitySinceSecRef.current;
      switch (event._tag) {
        case "ReactionAdded":
        case "OwnReactionConfirmed":
        case "ReactionRetracted":
        case "OwnRetractionConfirmed":
          return processReactionInboxEvent(event, reactionCtx);
        case "ChatMessageReceived": {
          const handled = applyChatMessageReceived(event, chatCtx);
          if (!handled.inserted) return handled.written;
          // Store reactions waiting for this message before its event is confirmed.
          const reactionsWritten = retryDeferredReactions(
            buildHandlers(myPubkey).reactionCtx,
          );
          if (delivery === "live") {
            notifyInsertedChatMessage(handled.inserted, notificationsCtx);
          }
          return allWrites([handled.written, reactionsWritten]);
        }
        case "OwnChatMessageConfirmed":
          return applyOwnChatMessageConfirmed(event, chatCtx);
        case "PaymentNoticeReceived": {
          if (isBlockedPubkey(event.from)) return NO_WRITE;
          if (cutoff !== null && event.sentAt < cutoff) return NO_WRITE;
          const contactId =
            notificationsCtx.findContact(event.from)?.id ??
            buildUnknownContactId(event.from);
          if (!contactId) return NO_WRITE;
          handlePaymentNoticeReceived(
            event,
            contactId,
            delivery,
            notificationsCtx,
          );
          return NO_WRITE;
        }
        case "BankOfferSnapshotReceived":
        case "OwnBankOfferSnapshotConfirmed": {
          if (cutoff !== null && event.sentAt < cutoff) return NO_WRITE;
          const peerPubkey =
            event._tag === "OwnBankOfferSnapshotConfirmed"
              ? event.to
              : event.from;
          if (isBlockedPubkey(peerPubkey)) return NO_WRITE;
          const contactId =
            notificationsCtx.findContact(peerPubkey)?.id ??
            buildUnknownContactId(peerPubkey);
          if (!contactId) return NO_WRITE;
          const accepted =
            paramsRef.current.applyBankPaymentOfferSnapshot(event);
          if (accepted.length === 0)
            reportAppLog({
              tag: "bankOffer.snapshotNotAuthorized",
              summary: "Bank offer snapshot lacks matching authorization",
              links: { rumor: event.snapshotId, offer: event.offerId },
              payload: { status: event.status },
            });
          for (const { event: snapshot, offer } of accepted)
            notifyBankOfferSnapshot(
              offer,
              {
                contactId,
                delivery,
                isOutgoing: offer.offererPublicKey === myPubkey,
                isSelfAuthored:
                  snapshot._tag === "OwnBankOfferSnapshotConfirmed",
                peerPubkey,
              },
              notificationsCtx,
            );
          return NO_WRITE;
        }
        case "SeenReceiptReceived":
          return applySeenReceiptReceived(event, seenReceiptCtx);
        case "OwnSeenReceiptConfirmed":
          applyOwnSeenReceiptConfirmed(event, seenReceiptCtx);
          return NO_WRITE;
        case "WrapDropped":
          return NO_WRITE;
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
      onEvent: async (event, delivery) => {
        const outcome = await dispatchInboxEvent(event, delivery);
        if (!outcome.ok) throw new Error(outcome.error);
      },
    });
    return () => setWrapInboxHandler(null);
  }, [currentNsec, dispatchInboxEvent, enabled, myPubkey, setWrapInboxHandler]);

  React.useEffect(() => {
    if (myPubkey === null) return;
    void retryDeferredReactions(buildHandlers(myPubkey).reactionCtx);
  }, [buildHandlers, myPubkey, nostrMessagesLocal]);

  return dispatchInboxEvent;
};
