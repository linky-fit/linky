import {
  Check,
  CheckCheck,
  FolderPlus,
  Info,
  HandCoins as PayIcon,
  Plus,
  X,
} from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  formatRemainingTime,
  getBankPaymentOfferStatusLabel,
  hasBankPaymentOfferTimedPhase,
  isLinkyBankPaymentOfferTerminalStatus,
  LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
  type LinkyBankPaymentOfferInfo,
  type LinkyBankPaymentOfferStatus,
} from "../app/lib/bankPaymentOffer";
import { parseIdentityChangeMessageContent } from "../app/lib/identityChangeMessage";
import {
  extractMessageLinks,
  normalizeMessageLinkMatch,
} from "../app/lib/messageLinks";
import type { CashuPaymentRequestMessageInfo } from "../app/lib/paymentRequestMessage";
import {
  canSharePrivateImage,
  downloadPrivateImageBlob,
  isCancelledShareError,
  sharePrivateImageBlob,
} from "../app/lib/privateImageFile";
import {
  isPrivatePdfPayload,
  parsePrivateImageMessage,
} from "../app/lib/privateImageMessage";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import { isStandaloneCashuTokenMessage } from "../app/lib/tokenText";
import type {
  ChatReactionChip,
  LocalNostrMessage,
} from "../app/types/appTypes";
import { deriveDefaultProfile } from "../derivedProfile";
import type { MintIcon } from "../utils/mint";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { Avatar } from "./Avatar";
import { CashuTokenPill } from "./CashuTokenPill";

import type { I18nKey, Translate } from "../i18n";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { MessageActionsMenu } from "./MessageActionsMenu";
import { MessageReactions } from "./MessageReactions";
import { PrivateFileBubble } from "./PrivateFileBubble";
import { PrivateImageBubble } from "./PrivateImageBubble";

export interface NpubMessageContactInfo {
  displayName: string;
  isSaved: boolean;
  npub: string;
  pictureUrl: string | null;
}

export type BankPaymentOfferPeerNotice =
  | "accepted_by_other"
  | "backup_recipient";

const MESSAGE_NPUB_PATTERN =
  /^(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?$/i;
const MESSAGE_INLINE_ENTITY_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?|cashu[0-9A-Za-z_-]+={0,2}|(?:https?:\/\/|www\.)[^\s<>"']+/gi;

interface ChatMessageProps {
  actionLabels: {
    copy: string;
    edit: string;
    edited: string;
    react: string;
    reply: string;
    save: string;
    share: string;
  };
  bankPaymentOfferInfo: LinkyBankPaymentOfferInfo | null;
  bankPaymentOfferPeerNotice: BankPaymentOfferPeerNotice | null;
  canOpenBankPaymentOfferDetails: boolean;
  canSettleBankPaymentOffer: boolean;
  canEdit: boolean;
  canActOnPaymentRequest: boolean;
  canReplyOrReact: boolean;
  chatPendingLabel: string;
  chatSeenLabel: string;
  declineInfo: { requestRumorId: string | null } | null;
  formatChatDayLabel: (ms: number) => string;
  getCashuTokenMessageInfo: (text: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  isSeen: boolean;
  locale: string;
  message: LocalNostrMessage;
  messageElRef?: (el: HTMLDivElement | null, messageId: string) => void;
  nextMessage: LocalNostrMessage | null;
  onCopy: (message: LocalNostrMessage) => void;
  onOpenBankPaymentOfferDetails: () => void;
  onSettleBankPaymentOffer: () => Promise<void>;
  onDeclinePaymentRequest: () => void;
  onEdit: (message: LocalNostrMessage) => void;
  onMintIconError: (origin: string, nextUrl: string | null) => void;
  onMintIconLoad: (origin: string, url: string | null) => void;
  onAddNpubContacts: (npubs: readonly string[], messageId: string) => void;
  contactsGroupAssignment: MessageContactsGroupAssignment | null;
  onOpenNpubContact: (npub: string) => void;
  onPayPaymentRequest: (requestInfo: CashuPaymentRequestMessageInfo) => void;
  onReact: (message: LocalNostrMessage, emoji: string) => void;
  onReply: (message: LocalNostrMessage) => void;
  payPaymentRequestBusy: boolean;
  payPaymentRequestDisabled: boolean;
  paymentRequestInfo: CashuPaymentRequestMessageInfo | null;
  paymentRequestStatus: "declined" | "paid" | "requested" | null;
  previousMessage: LocalNostrMessage | null;
  reactions: readonly ChatReactionChip[];
  replyQuoteText: string | null;
  settleBankPaymentOfferBusy: boolean;
}

const SWIPE_REPLY_THRESHOLD = 48;
const SWIPE_REPLY_VERTICAL_TOLERANCE = 24;
const LONG_PRESS_MS = 450;
const chatTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const getChatTimeFormatter = (locale: string): Intl.DateTimeFormat => {
  const cached = chatTimeFormatters.get(locale);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  chatTimeFormatters.set(locale, formatter);
  return formatter;
};

const getBankPaymentOfferDescriptionKey = (
  status: LinkyBankPaymentOfferStatus,
  isOut: boolean,
): I18nKey | null => {
  switch (status) {
    case "accepted":
      return isOut
        ? "bankPaymentOfferDescriptionAccepted"
        : "bankPaymentOfferDescriptionAcceptedIncoming";
    case "accepted_by_other":
      return "bankPaymentOfferAcceptedByOther";
    case "bank_paid":
      return isOut
        ? "bankPaymentOfferDescriptionBankPaid"
        : "bankPaymentOfferDescriptionBankPaidIncoming";
    case "declined":
      return "bankPaymentOfferDescriptionDeclined";
    case "offered":
      return "bankPaymentOfferDescriptionOffered";
    case "bank_details_sent":
    case "canceled":
    case "settled":
      return null;
  }
};

const getBankPaymentOfferDescription = (
  status: LinkyBankPaymentOfferStatus,
  amountText: string,
  isOut: boolean,
  t: Translate,
): string => {
  const key = getBankPaymentOfferDescriptionKey(status, isOut);
  return key ? t(key).replace("{amount}", amountText) : "";
};

function ChatMessageComponent({
  actionLabels,
  bankPaymentOfferInfo,
  bankPaymentOfferPeerNotice,
  canOpenBankPaymentOfferDetails,
  canSettleBankPaymentOffer,
  canEdit,
  canActOnPaymentRequest,
  canReplyOrReact,
  chatPendingLabel,
  chatSeenLabel,
  declineInfo,
  formatChatDayLabel,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  isSeen,
  locale,
  message,
  messageElRef,
  nextMessage,
  onCopy,
  onDeclinePaymentRequest,
  onEdit,
  onMintIconError,
  onMintIconLoad,
  onAddNpubContacts,
  contactsGroupAssignment,
  onOpenBankPaymentOfferDetails,
  onOpenNpubContact,
  onPayPaymentRequest,
  onReact,
  onReply,
  onSettleBankPaymentOffer,
  payPaymentRequestBusy,
  payPaymentRequestDisabled,
  paymentRequestInfo,
  paymentRequestStatus,
  previousMessage,
  reactions,
  replyQuoteText,
  settleBankPaymentOfferBusy,
}: ChatMessageProps) {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [privateImageBlob, setPrivateImageBlob] = React.useState<Blob | null>(
    null,
  );
  const [isSettlingBankPaymentOffer, setIsSettlingBankPaymentOffer] =
    React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressFiredRef = React.useRef(false);
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const swipeTriggeredRef = React.useRef(false);
  const messageDivRef = React.useRef<HTMLDivElement | null>(null);

  const isOut = message.direction === "out";
  const isPending = isOut && (message.status ?? "sent") === "pending";
  const content = message.content;
  const privateImageInfo = React.useMemo(
    () => parsePrivateImageMessage(content),
    [content],
  );
  const messageId = message.id;
  const rumorId = (message.rumorId ?? "").trim() || null;
  const replyToId = (message.replyToId ?? "").trim() || null;
  const rootMessageId = (message.rootMessageId ?? "").trim() || null;
  const createdAtSec = message.createdAtSec || 0;
  const ms = createdAtSec * 1000;
  const d = new Date(ms);
  const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const minuteKey = Math.floor(createdAtSec / 60);

  const prevSec = previousMessage ? previousMessage.createdAtSec || 0 : 0;
  const prevDate = previousMessage ? new Date(prevSec * 1000) : null;
  const prevDayKey = prevDate
    ? `${prevDate.getFullYear()}-${prevDate.getMonth() + 1}-${prevDate.getDate()}`
    : null;

  const nextSec = nextMessage ? nextMessage.createdAtSec || 0 : 0;
  const nextMinuteKey = nextMessage ? Math.floor(nextSec / 60) : null;
  const isIdentityChangeMessage =
    parseIdentityChangeMessageContent(content) !== null;

  const showDaySeparator = prevDayKey !== dayKey;
  const showTime = !isIdentityChangeMessage && nextMinuteKey !== minuteKey;

  const timeLabel = getChatTimeFormatter(locale).format(d);

  const tokenInfo = privateImageInfo ? null : getCashuTokenMessageInfo(content);
  const isDeclineMessage = Boolean(declineInfo);
  const bankOfferDisplayAmount = bankPaymentOfferInfo?.amountSat
    ? formatDisplayedAmountText(bankPaymentOfferInfo.amountSat)
    : (bankPaymentOfferInfo?.amountText ?? "");
  const bankOfferDescription = bankPaymentOfferInfo
    ? getBankPaymentOfferDescription(
        bankPaymentOfferInfo.status,
        bankOfferDisplayAmount,
        isOut,
        t,
      )
    : "";
  const bankOfferPhaseTtlSec =
    bankPaymentOfferInfo &&
    hasBankPaymentOfferTimedPhase(bankPaymentOfferInfo.status)
      ? LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC
      : null;
  const bankOfferPhaseStartedAtSec =
    bankPaymentOfferInfo?.statusUpdatedAtSec ?? createdAtSec;
  const bankOfferRemainingSec =
    bankOfferPhaseTtlSec && bankOfferPhaseStartedAtSec > 0
      ? bankOfferPhaseStartedAtSec +
        bankOfferPhaseTtlSec -
        Math.floor(nowMs / 1000)
      : null;
  const bankOfferTimeLabel =
    bankOfferRemainingSec === null
      ? null
      : formatRemainingTime(bankOfferRemainingSec, t);
  const bankOfferPeerNoticeText =
    bankPaymentOfferPeerNotice === "accepted_by_other"
      ? t("bankPaymentOfferAcceptedByOther")
      : bankPaymentOfferPeerNotice === "backup_recipient"
        ? t("bankPaymentOfferBackupRecipient")
        : "";

  const settleBankPaymentOffer = async () => {
    if (
      !canSettleBankPaymentOffer ||
      settleBankPaymentOfferBusy ||
      isSettlingBankPaymentOffer
    ) {
      return;
    }

    setIsSettlingBankPaymentOffer(true);
    try {
      await onSettleBankPaymentOffer();
    } finally {
      setIsSettlingBankPaymentOffer(false);
    }
  };

  React.useEffect(() => {
    if (!bankOfferPhaseTtlSec) return;
    if (bankOfferPhaseStartedAtSec <= 0) return;

    const expiresAtMs =
      (bankOfferPhaseStartedAtSec + bankOfferPhaseTtlSec) * 1_000;
    if (Date.now() >= expiresAtMs) return;

    let timeoutId: number | null = null;
    const scheduleNextTick = () => {
      const currentNowMs = Date.now();
      if (currentNowMs >= expiresAtMs) return;

      const nextSecondMs = (Math.floor(currentNowMs / 1_000) + 1) * 1_000;
      const nextBoundaryMs = Math.min(nextSecondMs, expiresAtMs);
      timeoutId = window.setTimeout(() => {
        setNowMs(Date.now());
        scheduleNextTick();
      }, nextBoundaryMs - currentNowMs);
    };

    scheduleNextTick();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [bankOfferPhaseStartedAtSec, bankOfferPhaseTtlSec]);

  const renderCashuTokenPill = React.useCallback(
    (info: CashuTokenMessageInfo, key?: string) => {
      const amountText = formatDisplayedAmountText(info.amount ?? 0);
      return (
        <CashuTokenPill
          key={key}
          icon={getMintIconUrl(info.mintUrl)}
          amountText={amountText}
          ariaLabel={
            info.mintDisplay
              ? `${amountText} · ${info.mintDisplay}`
              : amountText
          }
          className="chat-token-pill"
          isMuted={!info.isValid}
          onMintIconLoad={onMintIconLoad}
          onMintIconError={onMintIconError}
        />
      );
    },
    [
      formatDisplayedAmountText,
      getMintIconUrl,
      onMintIconError,
      onMintIconLoad,
    ],
  );

  const inlineMessageContent = React.useMemo(() => {
    if (
      paymentRequestInfo ||
      isDeclineMessage ||
      bankPaymentOfferInfo ||
      privateImageInfo
    ) {
      return null;
    }

    const segments: React.ReactNode[] = [];
    const matches = Array.from(content.matchAll(MESSAGE_INLINE_ENTITY_PATTERN));
    if (matches.length === 0) return null;

    let cursor = 0;
    let replacementCount = 0;

    for (const match of matches) {
      const matchedText = match[0];
      const start = match.index ?? 0;
      const end = start + matchedText.length;

      if (start > cursor) {
        segments.push(content.slice(cursor, start));
      }

      const messageLink = normalizeMessageLinkMatch(matchedText);
      const normalizedNpub = MESSAGE_NPUB_PATTERN.test(matchedText)
        ? normalizeNpubIdentifier(matchedText)
        : null;
      if (messageLink) {
        replacementCount += 1;
        segments.push(
          <a
            key={`${messageId}-link-${start}`}
            className="chat-message-link"
            href={messageLink.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {messageLink.displayText}
          </a>,
        );
        if (messageLink.trailingText) {
          segments.push(messageLink.trailingText);
        }
      } else if (normalizedNpub) {
        const npubContactInfo = getNpubMessageContactInfo(normalizedNpub);
        if (!npubContactInfo) {
          segments.push(matchedText);
        } else {
          replacementCount += 1;
          segments.push(
            <button
              key={`${messageId}-npub-${start}`}
              type="button"
              className="pill chat-contact-pill"
              onClick={() => onOpenNpubContact(npubContactInfo.npub)}
              aria-label={npubContactInfo.displayName}
            >
              {!npubContactInfo.isSaved ? (
                <span className="chat-contact-pill-add" aria-hidden="true">
                  <Plus size={12} strokeWidth={2.5} />
                </span>
              ) : null}
              <span className="chat-contact-pill-avatar" aria-hidden="true">
                <Avatar
                  pictureUrl={npubContactInfo.pictureUrl}
                  fallback={deriveDefaultProfile(
                    npubContactInfo.npub,
                  ).name.charAt(0)}
                  fallbackClassName="chat-contact-pill-avatar-fallback"
                  loading="lazy"
                />
              </span>
              <span className="chat-contact-pill-label">
                {npubContactInfo.displayName}
              </span>
            </button>,
          );
        }
      } else {
        const inlineTokenInfo = getCashuTokenMessageInfo(matchedText);
        if (!inlineTokenInfo) {
          segments.push(matchedText);
        } else {
          replacementCount += 1;
          segments.push(
            renderCashuTokenPill(
              inlineTokenInfo,
              `${messageId}-cashu-${start}`,
            ),
          );
        }
      }

      cursor = end;
    }

    if (cursor < content.length) {
      segments.push(content.slice(cursor));
    }

    return replacementCount > 0 ? segments : null;
  }, [
    content,
    getCashuTokenMessageInfo,
    getNpubMessageContactInfo,
    bankPaymentOfferInfo,
    isDeclineMessage,
    messageId,
    onOpenNpubContact,
    paymentRequestInfo,
    privateImageInfo,
    renderCashuTokenPill,
  ]);

  const unsavedMessageContactNpubs = React.useMemo(() => {
    if (
      isOut ||
      paymentRequestInfo ||
      isDeclineMessage ||
      bankPaymentOfferInfo ||
      privateImageInfo
    ) {
      return [];
    }

    const npubs: string[] = [];
    const seenNpubs = new Set<string>();
    const matches = Array.from(content.matchAll(MESSAGE_INLINE_ENTITY_PATTERN));

    for (const match of matches) {
      const matchedText = match[0];
      if (!MESSAGE_NPUB_PATTERN.test(matchedText)) continue;

      const normalizedNpub = normalizeNpubIdentifier(matchedText);
      if (!normalizedNpub || seenNpubs.has(normalizedNpub)) continue;

      const contactInfo = getNpubMessageContactInfo(normalizedNpub);
      if (!contactInfo || contactInfo.isSaved) continue;

      seenNpubs.add(normalizedNpub);
      npubs.push(contactInfo.npub);
    }

    return npubs;
  }, [
    bankPaymentOfferInfo,
    content,
    getNpubMessageContactInfo,
    isDeclineMessage,
    isOut,
    paymentRequestInfo,
    privateImageInfo,
  ]);

  const isStandaloneTokenMessage = React.useMemo(() => {
    if (!tokenInfo) return false;
    return isStandaloneCashuTokenMessage(content);
  }, [content, tokenInfo]);

  const previewUrl = React.useMemo(() => {
    if (
      paymentRequestInfo ||
      bankPaymentOfferInfo ||
      isDeclineMessage ||
      privateImageInfo ||
      isStandaloneTokenMessage
    ) {
      return null;
    }
    return extractMessageLinks(content)[0]?.url ?? null;
  }, [
    bankPaymentOfferInfo,
    content,
    isDeclineMessage,
    isStandaloneTokenMessage,
    paymentRequestInfo,
    privateImageInfo,
  ]);

  const refocusAfterMenuRef = React.useRef<HTMLElement | null>(null);

  const openMenu = React.useCallback(() => {
    // Close the keyboard while the action sheet is up; remember the field so
    // closeMenu can bring the keyboard back.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active.isContentEditable)
    ) {
      refocusAfterMenuRef.current = active;
      active.blur();
    }
    setMenuOpen(true);
  }, []);

  const closeMenu = React.useCallback(() => {
    setMenuOpen(false);
    const el = refocusAfterMenuRef.current;
    refocusAfterMenuRef.current = null;
    // Must run synchronously inside the dismissing tap's click handler, or iOS
    // refuses to reopen the keyboard for a programmatic focus.
    if (el?.isConnected) el.focus();
  }, []);

  const imageActions = React.useMemo(() => {
    if (!privateImageInfo || !privateImageBlob) return null;
    const exportLinks = rumorId ? { rumor: rumorId } : {};
    const fileName = privateImageInfo.fileName;
    const title = isPrivatePdfPayload(privateImageInfo)
      ? t("chatPdfMessage")
      : t("chatImageMessage");
    return {
      canShare: canSharePrivateImage(),
      onSave: () => {
        downloadPrivateImageBlob(privateImageBlob, exportLinks, fileName);
      },
      onShare: () => {
        void sharePrivateImageBlob(
          privateImageBlob,
          title,
          exportLinks,
          fileName,
        ).catch((error: unknown) => {
          if (isCancelledShareError(error)) return;
          downloadPrivateImageBlob(privateImageBlob, exportLinks, fileName);
        });
      },
    };
  }, [privateImageBlob, privateImageInfo, rumorId, t]);

  const clearLongPress = React.useCallback(() => {
    if (longPressTimerRef.current == null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    longPressFiredRef.current = false;
    if (event.pointerType !== "touch" || !canReplyOrReact) return;

    touchStartRef.current = { x: event.clientX, y: event.clientY };
    swipeTriggeredRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      openMenu();
    }, LONG_PRESS_MS);
  };

  // Touch browsers can still synthesize a click after the long-press timer
  // opened the menu; swallow it so it doesn't also trigger bubble content
  // (e.g. the image viewer).
  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!longPressFiredRef.current) return;
    longPressFiredRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const resetSwipeTransform = React.useCallback(() => {
    const el = messageDivRef.current;
    if (!el) return;
    el.style.transition = "transform 0.2s ease";
    el.style.transform = "";
    const onEnd = () => {
      el.style.transition = "";
      el.removeEventListener("transitionend", onEnd);
    };
    el.addEventListener("transitionend", onEnd);
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !canReplyOrReact) return;
    if (!touchStartRef.current) return;

    const dx = event.clientX - touchStartRef.current.x;
    const dy = event.clientY - touchStartRef.current.y;
    if (Math.abs(dy) > SWIPE_REPLY_VERTICAL_TOLERANCE) {
      clearLongPress();
      touchStartRef.current = null;
      resetSwipeTransform();
      return;
    }

    if (dx > 0 && !swipeTriggeredRef.current) {
      const clamped = Math.min(dx, SWIPE_REPLY_THRESHOLD);
      const el = messageDivRef.current;
      if (el) {
        el.style.transform = `translateX(${clamped}px)`;
      }
    }

    if (dx >= SWIPE_REPLY_THRESHOLD && !swipeTriggeredRef.current) {
      swipeTriggeredRef.current = true;
      clearLongPress();
      resetSwipeTransform();
      onReply(message);
    }
  };

  const handlePointerUp = () => {
    clearLongPress();
    touchStartRef.current = null;
    swipeTriggeredRef.current = false;
    resetSwipeTransform();
  };

  return (
    <React.Fragment key={messageId}>
      {showDaySeparator ? (
        <div className="chat-day-separator" aria-hidden="true">
          {formatChatDayLabel(ms)}
        </div>
      ) : null}

      {isIdentityChangeMessage ? (
        <div className="chat-day-separator" role="note">
          {t("chatIdentityChangedNotice")}
        </div>
      ) : null}

      {isIdentityChangeMessage ? null : (
        <div
          className={`chat-message ${isOut ? "out" : "in"}${isPending ? " pending" : ""}${isSeen ? " seen" : ""}`}
          data-message-id={messageId || undefined}
          data-rumor-id={rumorId ?? undefined}
          data-reply-to-id={replyToId ?? undefined}
          data-root-message-id={rootMessageId ?? undefined}
          ref={(el) => {
            messageDivRef.current = el;
            if (messageElRef && messageId) {
              messageElRef(el, messageId);
            }
          }}
          onClickCapture={handleClickCapture}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <MessageActionsMenu
            canCopy={!privateImageInfo}
            canEdit={canEdit}
            canReplyOrReact={canReplyOrReact}
            imageActions={imageActions}
            isOpen={menuOpen}
            labels={
              privateImageInfo && isPrivatePdfPayload(privateImageInfo)
                ? { ...actionLabels, save: t("chatPdfSave") }
                : actionLabels
            }
            onReply={() => onReply(message)}
            onEdit={() => onEdit(message)}
            onReact={(emoji) => onReact(message, emoji)}
            onCopy={() => onCopy(message)}
            onClose={closeMenu}
          />

          <div className="chat-bubble-wrap">
            <div className="chat-message-tools">
              <button
                type="button"
                className="chat-message-action-btn"
                onClick={() => (menuOpen ? closeMenu() : openMenu())}
                aria-label="Message actions"
              >
                ⋯
              </button>
            </div>
            <div className={isOut ? "chat-bubble out" : "chat-bubble in"}>
              {replyQuoteText && (
                <div className="chat-reply-quote">
                  <span>{replyQuoteText}</span>
                </div>
              )}
              {bankPaymentOfferInfo ? (
                <div className="chat-payment-request-card chat-bank-payment-offer-card">
                  <div className="chat-payment-request-header">
                    <span className="chat-payment-request-title">
                      {t("bankPaymentOfferTitle")}
                    </span>
                    <span
                      className={`chat-payment-request-status is-${bankPaymentOfferInfo.status}`}
                    >
                      {getBankPaymentOfferStatusLabel(
                        bankPaymentOfferInfo.status,
                        !isOut,
                        t,
                      )}
                    </span>
                  </div>
                  <div className="chat-bank-payment-amount-row">
                    <div className="chat-payment-request-amount">
                      {bankOfferDisplayAmount}
                    </div>
                  </div>
                  {bankOfferDescription ? (
                    <div className="chat-payment-request-description">
                      {bankOfferDescription}
                    </div>
                  ) : null}
                  {bankOfferPeerNoticeText ? (
                    <div className="chat-payment-request-description">
                      {bankOfferPeerNoticeText}
                    </div>
                  ) : null}
                  {bankOfferTimeLabel ? (
                    <div className="chat-bank-payment-timer">
                      {bankOfferTimeLabel}
                    </div>
                  ) : null}
                  {canOpenBankPaymentOfferDetails &&
                  !isLinkyBankPaymentOfferTerminalStatus(
                    bankPaymentOfferInfo.status,
                  ) ? (
                    <div className="chat-payment-request-actions">
                      <button
                        type="button"
                        className={`btn-wide ${canSettleBankPaymentOffer ? "secondary" : "chat-payment-request-pay"}`}
                        onClick={onOpenBankPaymentOfferDetails}
                      >
                        <span className="btn-label-with-icon">
                          <span className="btn-label-icon" aria-hidden="true">
                            <Info size={18} />
                          </span>
                          <span>{t("details")}</span>
                        </span>
                      </button>
                      {canSettleBankPaymentOffer ? (
                        <button
                          type="button"
                          className="btn-wide chat-payment-request-pay"
                          disabled={
                            settleBankPaymentOfferBusy ||
                            isSettlingBankPaymentOffer
                          }
                          onClick={() => void settleBankPaymentOffer()}
                        >
                          <span className="btn-label-with-icon">
                            <span className="btn-label-icon" aria-hidden="true">
                              {isSettlingBankPaymentOffer ? (
                                <span className="btn-spinner" />
                              ) : (
                                <Check size={18} />
                              )}
                            </span>
                            <span>{t("bankPaymentOfferMarkDone")}</span>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : paymentRequestInfo ? (
                <div className="chat-payment-request-card">
                  <div className="chat-payment-request-header">
                    <span className="chat-payment-request-title">
                      {t("requestPaymentLabel")}
                    </span>
                    <span
                      className={`chat-payment-request-status is-${paymentRequestStatus ?? "requested"}`}
                    >
                      {paymentRequestStatus === "paid"
                        ? t("paymentRequestStatusPaid")
                        : paymentRequestStatus === "declined"
                          ? t("paymentRequestStatusDeclined")
                          : t("paymentRequestStatusRequested")}
                    </span>
                  </div>
                  <div className="chat-payment-request-amount">
                    {formatDisplayedAmountText(paymentRequestInfo.amount)}
                  </div>
                  {canActOnPaymentRequest ? (
                    <div className="chat-payment-request-actions">
                      <button
                        type="button"
                        className="btn-wide chat-payment-request-pay"
                        disabled={payPaymentRequestDisabled}
                        onClick={() => onPayPaymentRequest(paymentRequestInfo)}
                        title={
                          payPaymentRequestDisabled && !payPaymentRequestBusy
                            ? t("payInsufficient")
                            : undefined
                        }
                      >
                        <span className="btn-label-with-icon">
                          <span className="btn-label-icon" aria-hidden="true">
                            {payPaymentRequestBusy ? (
                              <span className="btn-spinner" />
                            ) : (
                              <PayIcon size={18} />
                            )}
                          </span>
                          <span>
                            {payPaymentRequestBusy ? t("payPaying") : t("pay")}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn-wide secondary chat-payment-request-decline"
                        onClick={onDeclinePaymentRequest}
                      >
                        <span className="btn-label-with-icon">
                          <span className="btn-label-icon" aria-hidden="true">
                            <X size={18} />
                          </span>
                          <span>{t("decline")}</span>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : isDeclineMessage ? (
                <span className="pill pill-muted">
                  {t("paymentRequestDeclinedMessage")}
                </span>
              ) : privateImageInfo && isPrivatePdfPayload(privateImageInfo) ? (
                <PrivateFileBubble
                  onBlobChange={setPrivateImageBlob}
                  payload={privateImageInfo}
                  rumorId={rumorId}
                  t={t}
                />
              ) : privateImageInfo ? (
                <PrivateImageBubble
                  onBlobChange={setPrivateImageBlob}
                  payload={privateImageInfo}
                  rumorId={rumorId}
                  t={t}
                />
              ) : tokenInfo && isStandaloneTokenMessage ? (
                renderCashuTokenPill(tokenInfo)
              ) : inlineMessageContent ? (
                inlineMessageContent
              ) : (
                content
              )}
              {unsavedMessageContactNpubs.length > 1 ? (
                <button
                  type="button"
                  className="chat-add-all-contacts"
                  onClick={() =>
                    onAddNpubContacts(unsavedMessageContactNpubs, message.id)
                  }
                >
                  <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
                  <span>{t("addAllContacts")}</span>
                </button>
              ) : contactsGroupAssignment?.messageId === message.id ? (
                <MessageContactsGroupPicker
                  assignment={contactsGroupAssignment}
                  t={t}
                />
              ) : null}
              {previewUrl ? (
                <LinkPreviewCard key={previewUrl} url={previewUrl} />
              ) : null}
              {isSeen ? (
                <CheckCheck
                  className="chat-seen-check"
                  size={13}
                  strokeWidth={2.5}
                  role="img"
                  aria-label={chatSeenLabel}
                />
              ) : null}
            </div>
          </div>

          <MessageReactions
            reactions={reactions}
            showAddButton={false}
            onReact={(emoji) => onReact(message, emoji)}
          />

          {showTime ? (
            <div className="chat-time">
              {timeLabel}
              {message.isEdited ? (
                <>
                  {" "}
                  ·{" "}
                  <span
                    className="edited-indicator"
                    title={message.originalContent || undefined}
                  >
                    {actionLabels.edited}
                  </span>
                </>
              ) : null}
              {isPending ? ` · ${chatPendingLabel}` : ""}
            </div>
          ) : null}
        </div>
      )}
    </React.Fragment>
  );
}

export const ChatMessage = React.memo(ChatMessageComponent);

export interface MessageContactsGroupAssignment {
  messageId: string;
  contactCount: number;
  groupNames: string[];
  onAssign: (group: string) => void;
  onDismiss: () => void;
}

function MessageContactsGroupPicker({
  assignment,
  t,
}: {
  assignment: MessageContactsGroupAssignment;
  t: Translate;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [groupInput, setGroupInput] = React.useState("");
  const newGroup = groupInput.trim();
  const title = t(
    assignment.contactCount >= 2 && assignment.contactCount <= 4
      ? "addToGroupTitleFew"
      : "addToGroupTitle",
  ).replace("{count}", String(assignment.contactCount));

  // The picker lives inside the bubble that owns long-press/swipe gestures;
  // its own interactions must not start them.
  return (
    <div
      className={
        isExpanded ? "chat-add-to-group is-expanded" : "chat-add-to-group"
      }
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="chat-add-to-group-header">
        <button
          type="button"
          className="chat-add-to-group-toggle"
          onClick={() => setIsExpanded(true)}
          aria-expanded={isExpanded}
        >
          <FolderPlus size={15} aria-hidden="true" />
          <span>{isExpanded ? title : t("addToGroupAction")}</span>
        </button>
        <button
          type="button"
          className="icon-only-ghost chat-add-to-group-dismiss"
          onClick={assignment.onDismiss}
          aria-label={t("close")}
          title={t("close")}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {isExpanded ? (
        <>
          {assignment.groupNames.length > 0 ? (
            <div className="contact-group-pills">
              {assignment.groupNames.map((group) => (
                <button
                  key={group}
                  type="button"
                  className="group-filter-btn contact-group-pill"
                  onClick={() => assignment.onAssign(group)}
                >
                  {group}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="chat-add-to-group-new"
            onSubmit={(event) => {
              event.preventDefault();
              if (newGroup) assignment.onAssign(newGroup);
            }}
          >
            <input
              autoFocus
              value={groupInput}
              onChange={(event) => setGroupInput(event.target.value)}
              placeholder={t("groupPlaceholder")}
            />
            <button type="submit" disabled={!newGroup}>
              {t("add")}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
