import type { PaymentNoticeReceived } from "@linky/linkstr";
import { encodeNpub, parsePubkey } from "@linky/linkstr";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { formatShortNpub } from "../../../utils/formatting";
import {
  isTerminalBankPaymentOfferStatus,
  type BankPaymentOffer,
} from "@linky/proxy-payment";
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
import type { Translate } from "../../../i18n";

const PAYMENT_NOTICE_MATCH_WINDOW_SECONDS = 120;

export interface InboxContact {
  id: string;
  name: string | null;
  npub: string | null;
}

export interface InboxNotificationsContext {
  findContact: (pubkey: string) => InboxContact | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  messages: readonly LocalNostrMessage[];
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

interface BankOfferSnapshotScope {
  contactId: string;
  delivery: "backfill" | "live";
  isOutgoing: boolean;
  isSelfAuthored: boolean;
  peerPubkey: string;
}

/** Interruptions for an accepted snapshot; state was already applied. */
export const notifyBankOfferSnapshot = (
  offer: BankPaymentOffer,
  scope: BankOfferSnapshotScope,
  ctx: InboxNotificationsContext,
): void => {
  if (scope.delivery !== "live") return;

  const activeChat = isOpenChatForContact(ctx.route, scope.contactId);
  const activeOffer = isOpenBankPaymentOffer(ctx.route, offer.offerId);
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
      offer.snapshotId,
    );
  };
  if (isTerminalBankPaymentOfferStatus(offer.status)) {
    if (
      offer.status === "accepted_by_other" &&
      !scope.isOutgoing &&
      !scope.isSelfAuthored &&
      !activeChat &&
      !activeOffer
    ) {
      notifyOffer(ctx.t("bankPaymentOfferAcceptedByOther"));
    }
    if (
      offer.status === "declined" &&
      scope.isOutgoing &&
      !scope.isSelfAuthored &&
      !activeChat &&
      !activeOffer
    ) {
      notifyOffer(ctx.t("bankPaymentOfferDeclinedNotification"));
    }
    return;
  }

  if (scope.isSelfAuthored) return;
  if (!activeChat && !activeOffer) {
    showVisibleToast(
      ctx,
      ctx
        .t("chatIncomingMessageToast")
        .replace("{name}", senderLabel(ctx, scope.peerPubkey))
        .replace("{message}", offer.text),
    );
  }
  void ctx.maybeShowPwaNotification(
    notificationTitle(ctx, scope.peerPubkey),
    offer.text,
    offer.snapshotId,
  );
};
