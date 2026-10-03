import {
  Amount,
  border,
  Button,
  Chip,
  DaySeparator,
  duration,
  easing,
  Icon,
  IconButton,
  MessageBubble,
  MessageLink,
  Pill,
  Row,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import type { Tone } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  bankPaymentOfferStatusTones,
  formatRemainingTime,
  getBankPaymentOfferStatusLabel,
  getUnmatchedBankPaymentOfferStatus,
} from "../app/lib/bankPaymentOfferLabels";
import {
  BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
  type BankOfferStatus,
  type BankPaymentOfferInfo,
  hasBankPaymentOfferTimedPhase,
  isTerminalBankPaymentOfferStatus,
} from "@linky-fit/proxy-payment";
import { parseIdentityChangeMessageContent } from "../app/lib/identityChangeMessage";
import {
  extractMessageLinks,
  normalizeMessageLinkMatch,
} from "../app/lib/messageLinks";
import type { CashuPaymentRequestMessageInfo } from "../app/lib/paymentRequestMessage";
import {
  canSharePrivateImage,
  downloadPrivateImageBlob,
  sharePrivateImageBlob,
} from "../app/lib/privateImageFile";
import { isCancelledShareError } from "../platform/fileExport";
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
import type { MintIcon } from "../utils/mint";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { CashuTokenPill } from "./CashuTokenPill";
import { ContactPill } from "./ContactPill";

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
    menu: string;
    moreEmojis: string;
    react: string;
    reply: string;
    save: string;
    share: string;
  };
  bankPaymentOfferInfo: BankPaymentOfferInfo | null;
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
  onMintIconError: (url: string) => void;
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

const statusTones: Record<BankOfferStatus | "paid" | "requested", Tone> = {
  ...bankPaymentOfferStatusTones,
  paid: "accent",
  requested: "warning",
};

const getBankPaymentOfferDescriptionKey = (
  status: BankOfferStatus,
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
  status: BankOfferStatus,
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
  const { formatDisplayedAmountParts, formatDisplayedAmountText, t } =
    useAppShellCore();
  const paymentCardAmount = (amountSat: number): PaymentCardAmount => {
    const parts = formatDisplayedAmountParts(amountSat);
    return {
      value: `${parts.approxPrefix}${parts.amountText}`,
      unit: parts.unitLabel.trim() || undefined,
    };
  };
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
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
  const unmatchedBankOfferStatus = bankPaymentOfferInfo
    ? getUnmatchedBankPaymentOfferStatus(bankPaymentOfferInfo)
    : null;
  const bankOfferStatus =
    unmatchedBankOfferStatus ?? bankPaymentOfferInfo?.status ?? null;
  const bankOfferDescription = bankPaymentOfferInfo
    ? getBankPaymentOfferDescription(
        bankOfferStatus ?? bankPaymentOfferInfo.status,
        bankOfferDisplayAmount,
        isOut,
        t,
      )
    : "";
  const bankOfferPhaseTtlSec =
    bankPaymentOfferInfo &&
    hasBankPaymentOfferTimedPhase(bankPaymentOfferInfo.status)
      ? BANK_PAYMENT_OFFER_PHASE_TTL_SEC
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
          mintIcon={getMintIconUrl(info.mintUrl)}
          label={amountText}
          accessibilityLabel={[
            amountText,
            info.mintDisplay,
            info.isValid ? null : t("cashuInvalid"),
          ]
            .filter(Boolean)
            .join(" · ")}
          {...(info.isHiddenTestMint
            ? { hint: t("cashuTestMintHiddenHint") }
            : info.memo
              ? { hint: info.memo }
              : {})}
          tone={!info.isValid || info.isHiddenTestMint ? "neutral" : "accent"}
          onMintIconError={onMintIconError}
        />
      );
    },
    [formatDisplayedAmountText, getMintIconUrl, onMintIconError, t],
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
          <MessageLink
            key={`${messageId}-link-${start}`}
            href={messageLink.url}
          >
            {messageLink.displayText}
          </MessageLink>,
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
            <ContactPill
              key={`${messageId}-npub-${start}`}
              info={npubContactInfo}
              onOpen={onOpenNpubContact}
              showAdd={!npubContactInfo.isSaved}
            />,
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
  React.useEffect(() => {
    const element = messageDivRef.current;
    if (!element) return;
    const swallowLongPressClick = (event: MouseEvent) => {
      if (!longPressFiredRef.current) return;
      longPressFiredRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("click", swallowLongPressClick, true);
    return () =>
      element.removeEventListener("click", swallowLongPressClick, true);
  }, [isIdentityChangeMessage]);

  const resetSwipeTransform = React.useCallback(() => {
    const el = messageDivRef.current;
    if (!el) return;
    el.style.transition = `transform ${duration.base}ms ${easing.standard}`;
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

  const setMessageNode = (node: unknown) => {
    const element = node instanceof HTMLDivElement ? node : null;
    messageDivRef.current = element;
    if (messageElRef && messageId) messageElRef(element, messageId);
  };

  const bankOfferCard = bankPaymentOfferInfo ? (
    <PaymentCard
      testID="chat-bank-payment-offer-card"
      status={bankOfferStatus ?? bankPaymentOfferInfo.status}
      title={t("bankPaymentOfferTitle")}
      statusLabel={getBankPaymentOfferStatusLabel(
        bankOfferStatus ?? bankPaymentOfferInfo.status,
        !isOut,
        t,
      )}
      amount={
        unmatchedBankOfferStatus
          ? null
          : bankPaymentOfferInfo.amountSat
            ? paymentCardAmount(bankPaymentOfferInfo.amountSat)
            : { value: bankPaymentOfferInfo.amountText }
      }
    >
      {bankOfferDescription ? (
        <CardNote>{bankOfferDescription}</CardNote>
      ) : null}
      {bankOfferPeerNoticeText ? (
        <CardNote>{bankOfferPeerNoticeText}</CardNote>
      ) : null}
      {bankOfferTimeLabel ? (
        <Text variant="caption" bold color="$colorSubtle">
          {bankOfferTimeLabel}
        </Text>
      ) : null}
      {canOpenBankPaymentOfferDetails &&
      !isTerminalBankPaymentOfferStatus(bankPaymentOfferInfo.status) ? (
        <Row gap="$sm">
          <Button
            flex={1}
            icon="Info"
            variant={canSettleBankPaymentOffer ? "secondary" : "primary"}
            onPress={onOpenBankPaymentOfferDetails}
          >
            {t("details")}
          </Button>
          {canSettleBankPaymentOffer ? (
            <Button
              flex={1}
              icon="Check"
              loading={isSettlingBankPaymentOffer}
              disabled={settleBankPaymentOfferBusy}
              onPress={() => void settleBankPaymentOffer()}
            >
              {t("bankPaymentOfferMarkDone")}
            </Button>
          ) : null}
        </Row>
      ) : null}
    </PaymentCard>
  ) : null;

  const paymentRequestCard = paymentRequestInfo ? (
    <PaymentCard
      testID="chat-payment-request-card"
      status={paymentRequestStatus ?? "requested"}
      title={t("requestPaymentLabel")}
      statusLabel={
        paymentRequestStatus === "paid"
          ? t("paymentRequestStatusPaid")
          : paymentRequestStatus === "declined"
            ? t("paymentRequestStatusDeclined")
            : t("paymentRequestStatusRequested")
      }
      amount={paymentCardAmount(paymentRequestInfo.amount)}
    >
      {paymentRequestInfo.description ? (
        <CardNote>{paymentRequestInfo.description}</CardNote>
      ) : null}
      {message.isEdited && !isOut ? (
        <CardNote>{t("paymentRequestChanged")}</CardNote>
      ) : null}
      {canActOnPaymentRequest ? (
        <Row gap="$sm">
          <Button
            flex={1}
            icon="HandCoins"
            loading={payPaymentRequestBusy}
            disabled={payPaymentRequestDisabled}
            tooltip={
              payPaymentRequestDisabled && !payPaymentRequestBusy
                ? t("payInsufficient")
                : undefined
            }
            onPress={() => onPayPaymentRequest(paymentRequestInfo)}
          >
            {t("pay")}
          </Button>
          <Button
            flex={1}
            icon="X"
            variant="secondary"
            onPress={onDeclinePaymentRequest}
          >
            {t("decline")}
          </Button>
        </Row>
      ) : null}
    </PaymentCard>
  ) : null;

  const messageBody =
    bankOfferCard ??
    paymentRequestCard ??
    (isDeclineMessage ? (
      <Pill label={t("paymentRequestDeclinedMessage")} tone="neutral" />
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
    ) : (
      <MessageText>{inlineMessageContent ?? content}</MessageText>
    ));

  return (
    <React.Fragment key={messageId}>
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
      {showDaySeparator ? (
        <DaySeparator label={formatChatDayLabel(ms)} />
      ) : null}

      {isIdentityChangeMessage ? (
        <DaySeparator label={t("chatIdentityChangedNotice")} />
      ) : (
        <MessageBubble
          ref={setMessageNode}
          testID="chat-bubble"
          data-testid="chat-message"
          data-direction={isOut ? "out" : "in"}
          data-seen={isSeen ? "true" : undefined}
          data-pending={isPending ? "true" : undefined}
          data-message-id={messageId || undefined}
          data-rumor-id={rumorId ?? undefined}
          data-reply-to-id={replyToId ?? undefined}
          data-root-message-id={rootMessageId ?? undefined}
          userSelect="none"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          direction={isOut ? "outgoing" : "incoming"}
          pending={isPending}
          onContextMenu={(event: React.MouseEvent) => {
            event.preventDefault();
            openMenu();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          accessory={
            <Stack
              opacity={hovered || menuOpen ? 1 : 0}
              focusWithinStyle={{ opacity: 1 }}
            >
              <IconButton
                icon="Ellipsis"
                size="sm"
                accessibilityLabel={actionLabels.menu}
                onPress={() => (menuOpen ? closeMenu() : openMenu())}
              />
            </Stack>
          }
          footer={
            reactions.length > 0 || showTime ? (
              <Stack alignSelf="stretch" gap="$xs">
                <MessageReactions
                  reactions={reactions}
                  onReact={(emoji) => onReact(message, emoji)}
                />
                {showTime ? (
                  <Text
                    variant="caption"
                    color={isPending ? "$warningText" : "$colorMuted"}
                    textAlign={isOut ? "right" : "left"}
                  >
                    {timeLabel}
                    {message.isEdited ? ` · ${actionLabels.edited}` : ""}
                    {isPending ? ` · ${chatPendingLabel}` : ""}
                  </Text>
                ) : null}
              </Stack>
            ) : null
          }
        >
          {replyQuoteText ? (
            <Stack
              testID="chat-reply-quote"
              borderLeftWidth={border.emphasis}
              borderColor="$info"
              paddingLeft="$sm"
            >
              <Text variant="caption" color="$colorSubtle" numberOfLines={2}>
                {replyQuoteText}
              </Text>
            </Stack>
          ) : null}
          {isSeen ? (
            <Row alignItems="flex-end" gap="$sm">
              <Stack flexShrink={1}>{messageBody}</Stack>
              <Stack role="img" aria-label={chatSeenLabel}>
                <Icon name="CheckCheck" size="sm" color="$accent" />
              </Stack>
            </Row>
          ) : (
            messageBody
          )}
          {unsavedMessageContactNpubs.length > 1 ? (
            <Button
              size="sm"
              variant="accent"
              icon="Plus"
              onPress={() =>
                onAddNpubContacts(unsavedMessageContactNpubs, message.id)
              }
            >
              {t("addAllContacts")}
            </Button>
          ) : contactsGroupAssignment?.messageId === message.id ? (
            <MessageContactsGroupPicker
              assignment={contactsGroupAssignment}
              t={t}
            />
          ) : null}
          {previewUrl ? (
            <LinkPreviewCard key={previewUrl} url={previewUrl} />
          ) : null}
        </MessageBubble>
      )}
    </React.Fragment>
  );
}

/** Message text keeps links, pills and line breaks inline. */
function MessageText({ children }: { children: React.ReactNode }) {
  return (
    <Text whiteSpace="pre-wrap" wordWrap="break-word">
      {children}
    </Text>
  );
}

function CardNote({ children }: { children: string }) {
  return (
    <Text variant="caption" color="$colorMuted">
      {children}
    </Text>
  );
}

interface PaymentCardAmount {
  value: string;
  unit?: string | undefined;
}

interface PaymentCardProps {
  testID: string;
  status: keyof typeof statusTones;
  title: string;
  statusLabel: string;
  /** Null hides the amount, e.g. for a proxy payment this peer did not pay. */
  amount: PaymentCardAmount | null;
  children: React.ReactNode;
}

function PaymentCard({
  testID,
  status,
  title,
  statusLabel,
  amount,
  children,
}: PaymentCardProps) {
  return (
    <Stack testID={testID} data-status={status} gap="$sm" minWidth="$qr">
      <Row justifyContent="space-between" gap="$sm">
        <Text eyebrow>{title}</Text>
        <Pill size="sm" label={statusLabel} tone={statusTones[status]} />
      </Row>
      {amount ? (
        <Row>
          <Amount size="md" value={amount.value} unit={amount.unit} />
        </Row>
      ) : null}
      {children}
    </Stack>
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
  const stopGesture = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();

  // The picker lives inside the bubble that owns long-press/swipe gestures;
  // its own interactions must not start them.
  return (
    <Stack
      gap="$sm"
      onPointerDown={stopGesture}
      onPointerMove={stopGesture}
      onPointerUp={stopGesture}
      onContextMenu={stopGesture}
    >
      <Row gap="$xs">
        <Button
          flex={1}
          size="sm"
          variant="ghost"
          icon="FolderPlus"
          aria-expanded={isExpanded}
          onPress={() => setIsExpanded(true)}
        >
          {isExpanded ? title : t("addToGroupAction")}
        </Button>
        <IconButton
          icon="X"
          size="sm"
          accessibilityLabel={t("close")}
          onPress={assignment.onDismiss}
        />
      </Row>
      {isExpanded ? (
        <>
          {assignment.groupNames.length > 0 ? (
            <Row gap="$xs" flexWrap="wrap">
              {assignment.groupNames.map((group) => (
                <Chip
                  key={group}
                  label={group}
                  onPress={() => assignment.onAssign(group)}
                />
              ))}
            </Row>
          ) : null}
          <Row gap="$xs" alignItems="flex-end">
            <Stack flex={1}>
              <TextField
                label={t("groupPlaceholder")}
                hideLabel
                autoFocus
                value={groupInput}
                onChangeText={setGroupInput}
                placeholder={t("groupPlaceholder")}
                onSubmitEditing={() => {
                  if (newGroup) assignment.onAssign(newGroup);
                }}
              />
            </Stack>
            <Button
              disabled={!newGroup}
              onPress={() => assignment.onAssign(newGroup)}
            >
              {t("add")}
            </Button>
          </Row>
        </>
      ) : null}
    </Stack>
  );
}
