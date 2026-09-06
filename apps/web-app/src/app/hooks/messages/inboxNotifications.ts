import type {
  BankOfferInboxEvent,
  PaymentNoticeReceived,
} from "@linky/linkstr";
import {
  encodeBankOfferContent,
  encodeNpub,
  parsePubkey,
} from "@linky/linkstr";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { formatShortNpub } from "../../../utils/formatting";
import {
  getLinkyBankPaymentOfferInfo,
  getLinkyBankPaymentOfferMessageText,
  isLinkyBankPaymentOfferExpired,
  isLinkyBankPaymentOfferTerminalStatus,
  isLinkyBankPaymentOfferWholeOfferTerminalStatus,
} from "../../lib/bankPaymentOffer";
import { extractCashuTokenFromText } from "../../lib/tokenText";
import { formatChatMessagePreviewText } from "../../lib/chatMessageDisplay";
import {
  isOpenBankPaymentOffer,
  isOpenChatForContact,
} from "../../lib/inboxNotificationRoute";
import type {
  LocalNostrMessage,
  RouteWithOptionalId,
} from "../../types/appTypes";
import type { InsertedChatMessage } from "./chatInbox";
import { trimString } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";

const PAYMENT_NOTICE_MATCH_WINDOW_SECONDS = 120;

export interface InboxContact {
  id: string;
  name: string | null;
  npub: string | null;
}

export interface InboxNotificationsContext {
  bankPaymentOfferMessages: readonly LocalNostrMessage[];
  findContact: (pubkey: string) => InboxContact | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  messages: readonly LocalNostrMessage[];
  onBankPaymentOfferMessage: (message: LocalNostrMessage) => void;
  onOpenInboxMessageToast: (params: {
    contactId: string;
    messageId?: string;
  }) => void;
  pushToast: (message: string, options?: PushToastOptions) => void;
  route: RouteWithOptionalId;
  t: Translate;
}

const senderLabel = (
  ctx: InboxNotificationsContext,
  peerPubkey: string,
): string => {
  const contact = ctx.findContact(peerPubkey);
  const parsedPubkey = parsePubkey(peerPubkey);
  return (
    contact?.name ??
    formatShortNpub(
      contact?.npub ?? (parsedPubkey ? encodeNpub(parsedPubkey) : peerPubkey),
    ) ??
    ctx.t("unknownContactTitle")
  );
};

const notificationTitle = (
  ctx: InboxNotificationsContext,
  peerPubkey: string,
): string => {
  const contact = ctx.findContact(peerPubkey);
  return (
    contact?.name ??
    (contact ? ctx.t("appTitle") : ctx.t("unknownContactTitle"))
  );
};

const showVisibleToast = (
  ctx: InboxNotificationsContext,
  message: string,
  options?: PushToastOptions,
): void => {
  try {
    if (document.visibilityState === "visible") {
      if (options) ctx.pushToast(message, options);
      else ctx.pushToast(message);
    }
  } catch {
    // No document in non-browser environments.
  }
};

export const notifyInsertedChatMessage = (
  inserted: InsertedChatMessage,
  ctx: InboxNotificationsContext,
): void => {
  if (extractCashuTokenFromText(inserted.content) !== null) return;
  if (isOpenChatForContact(ctx.route, inserted.contactId)) return;

  const formattedPreview = formatChatMessagePreviewText({
    content: inserted.content,
    direction: "in",
    formatDisplayedAmountText: ctx.formatDisplayedAmountText,
    t: ctx.t,
  });
  const preview =
    formattedPreview.length > 80
      ? `${formattedPreview.slice(0, 80)}…`
      : formattedPreview;
  showVisibleToast(
    ctx,
    ctx
      .t("chatIncomingMessageToast")
      .replace("{name}", senderLabel(ctx, inserted.peerPubkey))
      .replace("{message}", preview),
    {
      onClick: () =>
        ctx.onOpenInboxMessageToast({
          contactId: inserted.contactId,
          ...(inserted.messageId ? { messageId: inserted.messageId } : {}),
        }),
    },
  );
  void ctx.maybeShowPwaNotification(
    notificationTitle(ctx, inserted.peerPubkey),
    formattedPreview,
    `msg_${inserted.peerPubkey}`,
  );
};

const hasStoredIncomingCashuToken = (
  ctx: InboxNotificationsContext,
  contactId: string,
  createdAtSec: number,
): boolean =>
  ctx.messages.some(
    (message) =>
      trimString(message.contactId) === contactId &&
      trimString(message.direction) === "in" &&
      Number.isFinite(message.createdAtSec) &&
      Math.abs(message.createdAtSec - createdAtSec) <=
        PAYMENT_NOTICE_MATCH_WINDOW_SECONDS &&
      extractCashuTokenFromText(message.content) !== null,
  );

export const handlePaymentNoticeReceived = (
  event: PaymentNoticeReceived,
  contactId: string,
  delivery: "backfill" | "live",
  ctx: InboxNotificationsContext,
): void => {
  if (hasStoredIncomingCashuToken(ctx, contactId, event.sentAt)) return;
  if (delivery !== "live") return;

  const paymentNoticeText =
    event.context === "bank_payment_offer"
      ? ctx.t("notificationReceivedBankPaymentReimbursement")
      : ctx.t("notificationReceivedMoney");
  const isActiveChat = isOpenChatForContact(ctx.route, contactId);
  const isActiveOffer = isOpenBankPaymentOffer(ctx.route, event.offerId ?? "");
  if (!isActiveChat && !isActiveOffer) {
    showVisibleToast(
      ctx,
      ctx
        .t("chatIncomingMessageToast")
        .replace("{name}", senderLabel(ctx, event.from))
        .replace("{message}", paymentNoticeText),
    );
  }
  void ctx.maybeShowPwaNotification(
    notificationTitle(ctx, event.from),
    paymentNoticeText,
    event.noticeId,
  );
};

export const bankOfferContentFromSnapshot = (
  snapshot: BankOfferInboxEvent,
): string =>
  encodeBankOfferContent({
    offerId: snapshot.offerId,
    offerer: snapshot.offerer,
    status: snapshot.status,
    amountText: snapshot.amountText,
    text:
      snapshot.text ??
      getLinkyBankPaymentOfferMessageText(
        snapshot.amountText,
        snapshot.status,
        snapshot.extensionSec,
      ),
    statusUpdatedAtSec: snapshot.statusUpdatedAtSec,
    initiatedAtSec: snapshot.initiatedAtSec,
    bankPaidAtSec: snapshot.bankPaidAtSec,
    expiresAtSec: snapshot.expiresAtSec,
    extensionSec: snapshot.extensionSec,
    amountSat: snapshot.amountSat,
    spdPayload: snapshot.spdPayload,
  });

interface BankOfferSnapshotScope {
  contactId: string;
  delivery: "backfill" | "live";
  isOutgoing: boolean;
  isSelfAuthored: boolean;
  peerPubkey: string;
}

export const handleBankOfferSnapshotReceived = (
  event: BankOfferInboxEvent,
  scope: BankOfferSnapshotScope,
  ctx: InboxNotificationsContext,
): void => {
  const content = bankOfferContentFromSnapshot(event);
  const offerInfo = getLinkyBankPaymentOfferInfo(content);
  const offerText = offerInfo?.text ?? null;
  if (!offerText) return;
  const offerId = trimString(offerInfo?.offerId);
  const isTerminalOffer = offerInfo
    ? isLinkyBankPaymentOfferTerminalStatus(offerInfo.status)
    : false;
  // Whole-offer statuses only: one recipient's declined thread must not
  // swallow another recipient's later acceptance of the offer.
  const hasTerminalKnownOffer = offerId
    ? ctx.bankPaymentOfferMessages.some((message) => {
        const knownInfo = getLinkyBankPaymentOfferInfo(message.content);
        return (
          knownInfo?.offerId === offerId &&
          isLinkyBankPaymentOfferWholeOfferTerminalStatus(knownInfo.status)
        );
      })
    : false;
  const isExpiredOffer =
    offerInfo && !isTerminalOffer
      ? isLinkyBankPaymentOfferExpired(offerInfo, event.sentAt, nowSeconds())
      : false;
  if (isExpiredOffer || (!isTerminalOffer && hasTerminalKnownOffer)) return;

  ctx.onBankPaymentOfferMessage({
    contactId: scope.contactId,
    content,
    createdAtSec: event.sentAt,
    direction: scope.isOutgoing ? "out" : "in",
    id: `bank-payment-offer:${event.snapshotId}`,
    localOnly: true,
    pubkey: event.offerer,
    rumorId: event.snapshotId,
    status: "sent",
    wrapId: event.snapshotId,
    ...(event.clientId !== null ? { clientId: event.clientId } : {}),
  });
  if (scope.delivery !== "live") return;

  const activeChat = isOpenChatForContact(ctx.route, scope.contactId);
  const activeOffer = isOpenBankPaymentOffer(ctx.route, offerId);
  const notifyOffer = (notificationText: string): void => {
    const label = senderLabel(ctx, scope.peerPubkey);
    showVisibleToast(
      ctx,
      ctx
        .t("chatIncomingMessageToast")
        .replace("{name}", label)
        .replace("{message}", notificationText),
      {
        onClick: () =>
          ctx.onOpenInboxMessageToast({ contactId: scope.contactId }),
      },
    );
    void ctx.maybeShowPwaNotification(
      label,
      notificationText,
      event.snapshotId,
    );
  };
  if (isTerminalOffer) {
    if (
      offerInfo?.status === "accepted_by_other" &&
      !scope.isOutgoing &&
      !scope.isSelfAuthored &&
      !activeChat &&
      !activeOffer
    ) {
      notifyOffer(ctx.t("bankPaymentOfferAcceptedByOther"));
    }
    if (
      offerInfo?.status === "declined" &&
      scope.isOutgoing &&
      !scope.isSelfAuthored &&
      !activeChat &&
      !activeOffer
    ) {
      notifyOffer(ctx.t("bankPaymentOfferDeclinedNotification"));
    }
    return;
  }

  if (!activeChat && !activeOffer && !scope.isSelfAuthored) {
    showVisibleToast(
      ctx,
      ctx
        .t("chatIncomingMessageToast")
        .replace("{name}", senderLabel(ctx, scope.peerPubkey))
        .replace("{message}", offerText),
    );
  }
  if (!scope.isSelfAuthored) {
    void ctx.maybeShowPwaNotification(
      notificationTitle(ctx, scope.peerPubkey),
      offerText,
      event.snapshotId,
    );
  }
};
