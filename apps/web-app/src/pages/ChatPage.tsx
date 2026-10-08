import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListRow,
  MessageComposerFrame,
  NearbyBanner,
  Notice,
  ReplyPreview,
  Row,
  Stack,
} from "@linky-fit/ui";
import { useDivRef } from "../hooks/useDivRef";
import { useLatest } from "../hooks/useLatest";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { parsePubkey } from "@linky-fit/linkstr";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useNearbyContact } from "../app/hooks/useBeacon";
import { aggregateReactions } from "../app/hooks/messages/chatReactions";
import type { EditChatContext } from "../app/hooks/messages/useEditChatMessage";
import type { ReplyContext } from "../app/hooks/messages/useSendChatMessage";
import {
  type BankPaymentOfferInfo,
  decodeBankPaymentOffer,
  isBankPaymentOfferExpired,
} from "@linky-fit/proxy-payment";
import {
  isBankPaymentOfferMinimized,
  setBankPaymentOfferMinimized,
} from "../app/lib/bankPaymentOfferStorage";
import { formatChatMessagePreviewText } from "../app/lib/chatMessageDisplay";
import {
  captureChatViewportAnchor,
  pinChatToBottom,
  restoreChatViewportAnchor,
  type ChatViewportAnchor,
} from "../app/lib/chatViewport";
import {
  getMessageEditorValue,
  setMessageEditorCaret,
} from "../app/lib/messageEditorDom";
import {
  applyMessageMentionSuggestion,
  getMessageMentionQuery,
  getMessageMentionSuggestions,
  type MessageMentionContact,
  type MessageMentionSuggestion,
} from "../app/lib/messageMentions";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
  type CashuPaymentRequestMessageInfo,
} from "../app/lib/paymentRequestMessage";
import { parsePrivateImageMessage } from "../app/lib/privateImageMessage";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import type {
  ChatReactionChip,
  LocalNostrMessage,
  LocalNostrReaction,
} from "../app/types/appTypes";
import { BlockContactButton } from "../components/BlockContactButton";
import { ChatAttachmentPreview } from "../components/ChatAttachmentPreview";
import {
  ChatMessage,
  type BankPaymentOfferPeerNotice,
  type MessageContactsGroupAssignment,
  type NpubMessageContactInfo,
} from "../components/ChatMessage";
import { ChatMessageEditor } from "../components/ChatMessageEditor";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatChatDayLabel, normalizeLocale } from "../utils/formatting";
import type { MintIcon } from "../utils/mint";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { pickFiles } from "../utils/pickFile";
import { nowSeconds } from "../utils/time";

interface Contact {
  id: string;
  isUnknownContact?: boolean;
  npub?: string | null;
  unknownPubkeyHex?: string | null;
  lnAddress?: string | null;
  chatPeerSeenSinceSec?: number | null;
  chatPeerSeenAtSec?: number | null;
}

interface ChatPageProps {
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  addChatAttachments: (files: readonly File[]) => void;
  cashuIsBusy: boolean;
  chatAttachments: readonly File[];
  chatDraft: string;
  chatMessageElByIdRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
  chatMessages: LocalNostrMessage[];
  bankPaymentOfferMessages: LocalNostrMessage[];
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  chatOwnPubkeyHex: string | null;
  chatSendIsBusy: boolean;
  editContext: EditChatContext | null;
  feedbackContactNpub: string;
  getCashuTokenMessageInfo: (id: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  lang: string;
  mentionContacts: MessageMentionContact[];
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onAddUnknownContact: () => Promise<void>;
  onAddNpubContacts: (npubs: readonly string[], messageId: string) => void;
  contactsGroupAssignment: MessageContactsGroupAssignment | null;
  onBlockUnknownContact: () => Promise<void>;
  onCopy: (message: LocalNostrMessage) => void;
  onDeclinePaymentRequest: (message: LocalNostrMessage) => Promise<void>;
  onSettleBankPaymentOffer: (message: LocalNostrMessage) => Promise<void>;
  onEdit: (message: LocalNostrMessage) => void;
  onOpenNpubContact: (npub: string) => void;
  onPayPaymentRequest: (
    message: LocalNostrMessage,
    requestInfo: CashuPaymentRequestMessageInfo,
  ) => Promise<void>;
  onReact: (message: LocalNostrMessage, emoji: string) => void;
  onReply: (message: LocalNostrMessage) => void;
  openContactPay: (
    id: string,
    returnToChat?: boolean,
    intent?: "pay" | "request",
  ) => void;
  payWithCashuEnabled: boolean;
  reactionsByMessageId: Map<string, LocalNostrReaction[]>;
  replyContext: ReplyContext | null;
  selectedContact: Contact | null;
  sendChatImage: (
    file: File,
    replyToMessage?: LocalNostrMessage,
  ) => Promise<boolean>;
  sendChatMessage: () => Promise<void>;
  removeChatAttachment: (file: File) => void;
  setChatDraft: (value: string) => void;
  markMintIconFailed: (url: string) => void;
}

interface IndexedBankPaymentOffer {
  contactId: string;
  info: BankPaymentOfferInfo;
  updatedAtSec: number;
}

interface ParsedChatMessage {
  bankPaymentOfferInfo: BankPaymentOfferInfo | null;
  declineInfo: ReturnType<typeof parseLinkyPaymentRequestDeclineMessage>;
  isCashuToken: boolean;
  paymentRequestInfo: CashuPaymentRequestMessageInfo | null;
  privateImageInfo: ReturnType<typeof parsePrivateImageMessage>;
}

interface ChatMessageViewModel extends ParsedChatMessage {
  bankPaymentOfferPeerNotice: BankPaymentOfferPeerNotice | null;
  canActOnPaymentRequest: boolean;
  canEdit: boolean;
  canReplyOrReact: boolean;
  canSettleBankPaymentOffer: boolean;
  isSeen: boolean;
  message: LocalNostrMessage;
  nextMessage: LocalNostrMessage | null;
  onDeclinePaymentRequest: () => void;
  onOpenBankPaymentOfferDetails: () => void;
  onPayPaymentRequest: (requestInfo: CashuPaymentRequestMessageInfo) => void;
  onSettleBankPaymentOffer: () => Promise<void>;
  payPaymentRequestDisabled: boolean;
  paymentRequestStatus: "declined" | "paid" | "requested" | null;
  previousMessage: LocalNostrMessage | null;
  reactions: readonly ChatReactionChip[];
  replyQuoteText: string | null;
}

const buildBankPaymentOfferIndex = (
  messages: LocalNostrMessage[],
): Map<string, IndexedBankPaymentOffer[]> => {
  const byOfferId = new Map<string, IndexedBankPaymentOffer[]>();

  for (const message of messages) {
    const info = decodeBankPaymentOffer(message.content);
    if (!info) continue;

    const indexed = {
      contactId: message.contactId.trim(),
      info,
      updatedAtSec: info.statusUpdatedAtSec || message.createdAtSec || 0,
    };
    const candidates = byOfferId.get(info.offerId);
    if (candidates) candidates.push(indexed);
    else byOfferId.set(info.offerId, [indexed]);
  }

  return byOfferId;
};

const getBankPaymentOfferPeerNotice = (
  message: LocalNostrMessage,
  offerInfo: BankPaymentOfferInfo | null,
  offersById: Map<string, IndexedBankPaymentOffer[]>,
): BankPaymentOfferPeerNotice | null => {
  if (!offerInfo || message.direction !== "out") return null;
  if (
    offerInfo.status === "accepted_by_other" ||
    offerInfo.status === "bank_details_sent" ||
    offerInfo.status === "bank_paid" ||
    offerInfo.status === "canceled" ||
    offerInfo.status === "settled"
  ) {
    return null;
  }

  const contactId = message.contactId.trim();
  const currentUpdatedAtSec =
    offerInfo.statusUpdatedAtSec || message.createdAtSec || 0;
  let otherAccepted = false;
  let otherHasPriority = false;

  for (const candidate of offersById.get(offerInfo.offerId) ?? []) {
    if (!candidate.contactId || candidate.contactId === contactId) continue;

    if (
      candidate.info.status === "bank_details_sent" ||
      candidate.info.status === "bank_paid" ||
      candidate.info.status === "settled"
    ) {
      otherAccepted = true;
      otherHasPriority = true;
      break;
    }

    if (candidate.info.status !== "accepted") continue;
    otherAccepted = true;
    if (
      offerInfo.status === "accepted" &&
      (candidate.updatedAtSec < currentUpdatedAtSec ||
        (candidate.updatedAtSec === currentUpdatedAtSec &&
          candidate.contactId.localeCompare(contactId) < 0))
    ) {
      otherHasPriority = true;
    }
  }

  if (!otherAccepted) return null;
  if (offerInfo.status === "accepted") {
    return otherHasPriority ? "backup_recipient" : null;
  }
  return "accepted_by_other";
};

interface ChatMessageListProps {
  bankPaymentOfferMessages: LocalNostrMessage[];
  canOpenBankPaymentOfferDetails: boolean;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  chatMessageElByIdRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
  chatMessages: LocalNostrMessage[];
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  chatOwnPubkeyHex: string | null;
  formatDisplayedAmountText: (amount: number) => string;
  getCashuTokenMessageInfo: (id: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: ChatPageProps["getMintIconUrl"];
  getNpubMessageContactInfo: ChatPageProps["getNpubMessageContactInfo"];
  lang: string;
  onCopy: ChatPageProps["onCopy"];
  onAddNpubContacts: ChatPageProps["onAddNpubContacts"];
  contactsGroupAssignment: ChatPageProps["contactsGroupAssignment"];
  onDeclinePaymentRequest: ChatPageProps["onDeclinePaymentRequest"];
  onEdit: ChatPageProps["onEdit"];
  onOpenNpubContact: ChatPageProps["onOpenNpubContact"];
  onPayPaymentRequest: ChatPageProps["onPayPaymentRequest"];
  onReact: ChatPageProps["onReact"];
  onReply: ChatPageProps["onReply"];
  onSettleBankPaymentOffer: ChatPageProps["onSettleBankPaymentOffer"];
  markMintIconFailed: ChatPageProps["markMintIconFailed"];
  /** Peer's reported seen window; 0 bounds mean no receipt yet. */
  peerSeenSinceSec: number;
  peerSeenUpToSec: number;
  reactionsByMessageId: Map<string, LocalNostrReaction[]>;
  selectedContactId: string;
  t: Translate;
}

const ChatMessageList = memo(function ChatMessageList({
  bankPaymentOfferMessages,
  canOpenBankPaymentOfferDetails,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  chatMessageElByIdRef,
  chatMessages,
  chatMessagesRef,
  chatOwnPubkeyHex,
  formatDisplayedAmountText,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  lang,
  onCopy,
  onAddNpubContacts,
  contactsGroupAssignment,
  onDeclinePaymentRequest,
  onEdit,
  onOpenNpubContact,
  onPayPaymentRequest,
  onReact,
  onReply,
  onSettleBankPaymentOffer,
  markMintIconFailed,
  peerSeenSinceSec,
  peerSeenUpToSec,
  reactionsByMessageId,
  selectedContactId,
  t,
}: ChatMessageListProps) {
  const actionLabels = useMemo(
    () => ({
      copy: t("copy"),
      edit: t("chatEditAction"),
      edited: t("chatEdited"),
      menu: t("chatMessageActions"),
      moreEmojis: t("chatMoreEmojis"),
      react: t("chatReactAction"),
      reply: t("chatReplyAction"),
      save: t("chatImageSave"),
      share: t("share"),
    }),
    [t],
  );
  const chatPendingLabel = t("chatPendingShort");
  const chatSeenLabel = t("chatSeenShort");
  const locale = normalizeLocale(lang);
  const formatChatDayLabelForLang = useCallback(
    (timestamp: number) => formatChatDayLabel(timestamp, lang, t),
    [lang, t],
  );
  const messagesNodeRef = useDivRef(chatMessagesRef);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentNodeRef = useDivRef(contentRef);
  useEffect(() => {
    const messages = chatMessagesRef.current;
    const content = contentRef.current;
    if (!messages || !content || typeof ResizeObserver === "undefined") return;
    return pinChatToBottom(messages, content);
  }, [chatMessagesRef]);
  const messageElRef = useCallback(
    (element: HTMLDivElement | null, messageId: string) => {
      const elements = chatMessageElByIdRef.current;
      if (element) elements.set(messageId, element);
      else elements.delete(messageId);
    },
    [chatMessageElByIdRef],
  );

  const viewModels = useMemo<ChatMessageViewModel[]>(() => {
    const byRumorId = new Map<string, LocalNostrMessage>();
    const parsedByMessage = new Map<LocalNostrMessage, ParsedChatMessage>();

    for (const message of chatMessages) {
      const content = message.content;
      const rumorId = (message.rumorId ?? "").trim();
      if (rumorId) byRumorId.set(rumorId, message);
      parsedByMessage.set(message, {
        bankPaymentOfferInfo: decodeBankPaymentOffer(content),
        declineInfo: parseLinkyPaymentRequestDeclineMessage(content),
        isCashuToken: Boolean(getCashuTokenMessageInfo(content)),
        paymentRequestInfo: parseCashuPaymentRequestMessage(content),
        privateImageInfo: parsePrivateImageMessage(content),
      });
    }

    const latestRequestResponseByRumorId = new Map<
      string,
      { respondedAtSec: number; status: "declined" | "paid" }
    >();
    for (const message of chatMessages) {
      const replyToId = (message.replyToId ?? "").trim();
      const parsed = parsedByMessage.get(message);
      if (!replyToId || !parsed) continue;
      if (!parsed.isCashuToken && !parsed.declineInfo) continue;

      const createdAtSec = message.createdAtSec || 0;
      const previous = latestRequestResponseByRumorId.get(replyToId);
      if (previous && previous.respondedAtSec > createdAtSec) continue;
      latestRequestResponseByRumorId.set(replyToId, {
        respondedAtSec: createdAtSec,
        status: parsed.isCashuToken ? "paid" : "declined",
      });
    }

    const offersById = buildBankPaymentOfferIndex(bankPaymentOfferMessages);

    return chatMessages.map((message, index) => {
      const parsed = parsedByMessage.get(message) ?? {
        bankPaymentOfferInfo: null,
        declineInfo: null,
        isCashuToken: false,
        paymentRequestInfo: null,
        privateImageInfo: null,
      };
      const rumorId = (message.rumorId ?? "").trim();
      const createdAtSec = message.createdAtSec || 0;
      const isSeen =
        message.direction === "out" &&
        createdAtSec > peerSeenSinceSec &&
        createdAtSec <= peerSeenUpToSec;
      const paymentRequestStatus = rumorId
        ? (latestRequestResponseByRumorId.get(rumorId)?.status ?? "requested")
        : "requested";
      const replyToId = (message.replyToId ?? "").trim();
      const fallbackReplyContent =
        (message.replyToContent ?? "").trim() || null;
      const repliedMessage = replyToId ? byRumorId.get(replyToId) : null;
      const replyQuoteText = replyToId
        ? formatChatMessagePreviewText({
            content: repliedMessage?.content ?? fallbackReplyContent ?? "",
            direction: repliedMessage?.direction ?? null,
            formatDisplayedAmountText,
            t,
          })
        : fallbackReplyContent
          ? formatChatMessagePreviewText({
              content: fallbackReplyContent,
              formatDisplayedAmountText,
              t,
            })
          : null;
      const bankPaymentOfferPeerNotice = getBankPaymentOfferPeerNotice(
        message,
        parsed.bankPaymentOfferInfo,
        offersById,
      );
      const offererPublicKey = (
        parsed.bankPaymentOfferInfo?.offererPublicKey ?? ""
      ).trim();
      const canSettleBankPaymentOffer =
        parsed.bankPaymentOfferInfo?.status === "bank_paid" &&
        ((Boolean(offererPublicKey) && offererPublicKey === chatOwnPubkeyHex) ||
          message.direction === "out");

      return {
        ...parsed,
        bankPaymentOfferPeerNotice,
        canActOnPaymentRequest:
          Boolean(parsed.paymentRequestInfo) &&
          message.direction === "in" &&
          !message.isEdited &&
          paymentRequestStatus === "requested",
        canEdit:
          message.direction === "out" &&
          Boolean(rumorId) &&
          !parsed.isCashuToken &&
          !parsed.paymentRequestInfo &&
          !parsed.privateImageInfo &&
          !parsed.bankPaymentOfferInfo &&
          !parsed.declineInfo,
        canReplyOrReact: Boolean(rumorId),
        canSettleBankPaymentOffer,
        isSeen,
        message,
        nextMessage:
          index + 1 < chatMessages.length ? chatMessages[index + 1] : null,
        onDeclinePaymentRequest: () => {
          void onDeclinePaymentRequest(message);
        },
        onOpenBankPaymentOfferDetails: () => {
          const offerId = (parsed.bankPaymentOfferInfo?.offerId ?? "").trim();
          const chatId = message.contactId.trim();
          if (!offerId || !chatId) return;
          setBankPaymentOfferMinimized(chatId, offerId, false);
          navigateTo({ route: "bankPaymentOffer", chatId, offerId });
        },
        onPayPaymentRequest: (requestInfo) => {
          void onPayPaymentRequest(message, requestInfo);
        },
        onSettleBankPaymentOffer: () => onSettleBankPaymentOffer(message),
        payPaymentRequestDisabled:
          !parsed.paymentRequestInfo ||
          cashuIsBusy ||
          parsed.paymentRequestInfo.amount > cashuBalanceAfterMelt,
        paymentRequestStatus: parsed.paymentRequestInfo
          ? paymentRequestStatus
          : null,
        previousMessage: index > 0 ? chatMessages[index - 1] : null,
        reactions: rumorId
          ? aggregateReactions(
              reactionsByMessageId.get(rumorId) ?? [],
              chatOwnPubkeyHex,
            )
          : [],
        replyQuoteText,
      };
    });
  }, [
    bankPaymentOfferMessages,
    cashuBalanceAfterMelt,
    cashuIsBusy,
    chatMessages,
    chatOwnPubkeyHex,
    formatDisplayedAmountText,
    getCashuTokenMessageInfo,
    onDeclinePaymentRequest,
    onPayPaymentRequest,
    onSettleBankPaymentOffer,
    peerSeenSinceSec,
    peerSeenUpToSec,
    reactionsByMessageId,
    selectedContactId,
    t,
  ]);

  return (
    <Stack
      ref={messagesNodeRef}
      role="log"
      aria-live="polite"
      flex={1}
      minHeight={0}
      overflowY="auto"
      paddingHorizontal="$xl"
    >
      <Stack
        ref={contentNodeRef}
        gap="$sm"
        paddingTop="$lg"
        paddingBottom="$md"
      >
        {viewModels.length === 0 ? (
          <EmptyState title={t("chatEmpty")} />
        ) : (
          viewModels.map((viewModel) => (
            <ChatMessage
              key={viewModel.message.id}
              message={viewModel.message}
              previousMessage={viewModel.previousMessage}
              nextMessage={viewModel.nextMessage}
              locale={locale}
              formatChatDayLabel={formatChatDayLabelForLang}
              getCashuTokenMessageInfo={getCashuTokenMessageInfo}
              getMintIconUrl={getMintIconUrl}
              getNpubMessageContactInfo={getNpubMessageContactInfo}
              onMintIconError={markMintIconFailed}
              actionLabels={actionLabels}
              canEdit={viewModel.canEdit}
              canReplyOrReact={viewModel.canReplyOrReact}
              reactions={viewModel.reactions}
              paymentRequestInfo={viewModel.paymentRequestInfo}
              paymentRequestStatus={viewModel.paymentRequestStatus}
              declineInfo={viewModel.declineInfo}
              bankPaymentOfferInfo={viewModel.bankPaymentOfferInfo}
              bankPaymentOfferPeerNotice={viewModel.bankPaymentOfferPeerNotice}
              canOpenBankPaymentOfferDetails={canOpenBankPaymentOfferDetails}
              canSettleBankPaymentOffer={viewModel.canSettleBankPaymentOffer}
              onOpenBankPaymentOfferDetails={
                viewModel.onOpenBankPaymentOfferDetails
              }
              onDeclinePaymentRequest={viewModel.onDeclinePaymentRequest}
              onPayPaymentRequest={viewModel.onPayPaymentRequest}
              onSettleBankPaymentOffer={viewModel.onSettleBankPaymentOffer}
              canActOnPaymentRequest={viewModel.canActOnPaymentRequest}
              payPaymentRequestDisabled={viewModel.payPaymentRequestDisabled}
              payPaymentRequestBusy={cashuIsBusy}
              replyQuoteText={viewModel.replyQuoteText}
              settleBankPaymentOfferBusy={cashuIsBusy}
              onCopy={onCopy}
              onAddNpubContacts={onAddNpubContacts}
              contactsGroupAssignment={contactsGroupAssignment}
              onEdit={onEdit}
              onOpenNpubContact={onOpenNpubContact}
              onReact={onReact}
              onReply={onReply}
              chatPendingLabel={chatPendingLabel}
              chatSeenLabel={chatSeenLabel}
              isSeen={viewModel.isSeen}
              messageElRef={messageElRef}
            />
          ))
        )}
      </Stack>
    </Stack>
  );
});

interface ChatComposerProps {
  canPayThisContact: boolean;
  canRequestThisContact: boolean;
  canStartPay: boolean;
  addChatAttachments: ChatPageProps["addChatAttachments"];
  cashuIsBusy: boolean;
  chatAttachments: readonly File[];
  chatDraft: string;
  chatSendIsBusy: boolean;
  composeInputRef: React.RefObject<HTMLDivElement | null>;
  editContext: EditChatContext | null;
  getCashuTokenMessageInfo: ChatPageProps["getCashuTokenMessageInfo"];
  getMintIconUrl: ChatPageProps["getMintIconUrl"];
  getNpubMessageContactInfo: ChatPageProps["getNpubMessageContactInfo"];
  hasUnknownPubkeyHex: boolean;
  isFeedbackContact: boolean;
  mentionContacts: MessageMentionContact[];
  npub: string | null;
  onCancelEdit: ChatPageProps["onCancelEdit"];
  onCancelReply: ChatPageProps["onCancelReply"];
  openContactPay: ChatPageProps["openContactPay"];
  replyContext: ReplyContext | null;
  replyPreviewText: string;
  selectedContact: Contact;
  sendChatImage: ChatPageProps["sendChatImage"];
  sendChatMessage: ChatPageProps["sendChatMessage"];
  removeChatAttachment: ChatPageProps["removeChatAttachment"];
  setChatDraft: ChatPageProps["setChatDraft"];
  t: Translate;
}

export const ChatComposer = memo(function ChatComposer({
  canPayThisContact,
  canRequestThisContact,
  canStartPay,
  addChatAttachments,
  cashuIsBusy,
  chatAttachments,
  chatDraft,
  chatSendIsBusy,
  composeInputRef,
  editContext,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  hasUnknownPubkeyHex,
  isFeedbackContact,
  mentionContacts,
  npub,
  onCancelEdit,
  onCancelReply,
  openContactPay,
  replyContext,
  replyPreviewText,
  selectedContact,
  sendChatImage,
  removeChatAttachment,
  sendChatMessage,
  setChatDraft,
  t,
}: ChatComposerProps) {
  const pendingSendDraftRef = useRef<string | null>(null);
  const [previousDraftProps, setPreviousDraftProps] = useState({
    chatDraft,
    chatSendIsBusy,
  });
  const [draft, setDraft] = useState(chatDraft);
  const draftRef = useLatest(draft);
  const [composeCaret, setComposeCaret] = useState(chatDraft.length);
  const isDesktop =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const mentionQuery = useMemo(
    () => getMessageMentionQuery(draft, composeCaret),
    [composeCaret, draft],
  );
  const mentionSuggestions = useMemo(
    () =>
      mentionQuery
        ? getMessageMentionSuggestions(
            mentionContacts,
            mentionQuery.query,
            npub,
          )
        : [],
    [mentionContacts, mentionQuery, npub],
  );
  const hasDraftText = Boolean(draft.trim());
  const hasRecipient = Boolean(npub || hasUnknownPubkeyHex);
  const hasAttachmentsToSend = chatAttachments.length > 0 && !editContext;
  const canSendChat =
    !chatSendIsBusy && hasRecipient && (hasDraftText || hasAttachmentsToSend);
  const canAttach = hasRecipient && !editContext;

  // Adjust before committing the render so a completed send cannot clear newer input.
  if (
    previousDraftProps.chatDraft !== chatDraft ||
    previousDraftProps.chatSendIsBusy !== chatSendIsBusy
  ) {
    setPreviousDraftProps({ chatDraft, chatSendIsBusy });
    const preserveNextDraft =
      chatDraft === "" &&
      (chatSendIsBusy || previousDraftProps.chatSendIsBusy) &&
      draft !== previousDraftProps.chatDraft;
    if (previousDraftProps.chatDraft !== chatDraft && !preserveNextDraft) {
      setDraft(chatDraft);
      setComposeCaret(chatDraft.length);
    }
  }

  useEffect(
    () => () => {
      setChatDraft(draftRef.current);
    },
    [setChatDraft, draftRef],
  );

  useEffect(() => {
    if (pendingSendDraftRef.current !== chatDraft) return;
    pendingSendDraftRef.current = null;
    void sendChatMessage();
  }, [chatDraft, sendChatMessage]);

  const focusComposeInput = useCallback(() => {
    const input = composeInputRef.current;
    if (!input || input.getAttribute("aria-disabled") === "true") return false;

    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    setMessageEditorCaret(input, getMessageEditorValue(input).length);
    return document.activeElement === input;
  }, [composeInputRef]);

  // Attachments have no caption field, so text must follow the files as a separate message.
  const requestSend = useCallback(async () => {
    if (!canSendChat) return;
    if (hasAttachmentsToSend) {
      for (const file of chatAttachments) {
        const sent = await sendChatImage(file);
        if (!sent) return;
        removeChatAttachment(file);
      }
    }
    if (!hasDraftText) return;
    if (draft === chatDraft) {
      void sendChatMessage();
      return;
    }

    pendingSendDraftRef.current = draft;
    setChatDraft(draft);
  }, [
    canSendChat,
    chatAttachments,
    chatDraft,
    draft,
    hasAttachmentsToSend,
    hasDraftText,
    removeChatAttachment,
    sendChatImage,
    sendChatMessage,
    setChatDraft,
  ]);

  const selectMentionSuggestion = useCallback(
    (suggestion: MessageMentionSuggestion) => {
      if (!mentionQuery) return;
      const next = applyMessageMentionSuggestion(
        draft,
        mentionQuery,
        suggestion,
      );
      setDraft(next.value);
      setComposeCaret(next.caret);
      window.requestAnimationFrame(() => {
        const input = composeInputRef.current;
        if (!input) return;
        input.focus();
        setMessageEditorCaret(input, next.caret);
      });
    },
    [composeInputRef, draft, mentionQuery],
  );

  useEffect(() => {
    if (!replyContext && !editContext) return;
    if (!npub && !hasUnknownPubkeyHex) return;
    focusComposeInput();
  }, [editContext, focusComposeInput, hasUnknownPubkeyHex, npub, replyContext]);

  const attachFiles = () => {
    void pickFiles({ accept: "image/*,application/pdf,.pdf", multiple: true })
      // A cancelled or late pick must not stage files the chat can no longer take.
      .then((files) => {
        if (files.length > 0 && canAttach) addChatAttachments(files);
      });
  };
  // Keeps the editor focused, and the iOS keyboard open, while tapping composer controls.
  const keepEditorFocus = (event: React.PointerEvent) => event.preventDefault();
  const showSend = hasDraftText || chatAttachments.length > 0;

  return (
    <Stack testID="chat-compose" data-safe-area="bottom">
      <MessageComposerFrame
        header={
          replyContext ||
          editContext ||
          chatAttachments.length > 0 ||
          mentionSuggestions.length > 0 ? (
            <>
              {replyContext ? (
                <ReplyPreview
                  author={t("chatReplyingTo")}
                  body={replyPreviewText || t("chatReplyUnavailable")}
                  dismiss={{ label: t("close"), onPress: onCancelReply }}
                />
              ) : null}
              {editContext ? (
                <ReplyPreview
                  author={t("chatEditing")}
                  body={editContext.originalContent || t("chatEmpty")}
                  dismiss={{ label: t("close"), onPress: onCancelEdit }}
                />
              ) : null}
              {chatAttachments.length > 0 ? (
                <ChatAttachmentPreview
                  accessibilityLabel={t("chatAttachments")}
                  addLabel={t("chatImageAttach")}
                  disabled={chatSendIsBusy}
                  files={chatAttachments}
                  onAdd={attachFiles}
                  onRemove={removeChatAttachment}
                  removeLabel={t("chatAttachmentRemove")}
                />
              ) : null}
              {mentionSuggestions.length > 0 ? (
                <Stack
                  role="list"
                  maxHeight="$qr"
                  overflowY="auto"
                  padding="$xs"
                  borderRadius="$control"
                  backgroundColor="$surfaceRaised"
                  onPointerDown={keepEditorFocus}
                >
                  {mentionSuggestions.map((suggestion) =>
                    suggestion.kind === "group" ? (
                      <ListRow
                        key={`group-${suggestion.groupName}`}
                        title={`@${suggestion.groupName}`}
                        meta={t("chatMentionGroupCount").replace(
                          "{count}",
                          String(suggestion.contacts.length),
                        )}
                        chevron={false}
                        onPress={() => selectMentionSuggestion(suggestion)}
                      />
                    ) : (
                      <ListRow
                        key={`contact-${suggestion.contact.npub}`}
                        leading={
                          <Avatar
                            name={suggestion.contact.name}
                            uri={
                              getNpubMessageContactInfo(suggestion.contact.npub)
                                ?.pictureUrl ?? undefined
                            }
                            size="sm"
                          />
                        }
                        title={suggestion.contact.name}
                        meta={suggestion.contact.groupName ?? undefined}
                        chevron={false}
                        onPress={() => selectMentionSuggestion(suggestion)}
                      />
                    ),
                  )}
                </Stack>
              ) : null}
            </>
          ) : null
        }
        footer={
          canPayThisContact ? (
            <Row gap="$sm">
              {canRequestThisContact ? (
                <Button
                  flex={1}
                  variant="secondary"
                  icon="Request"
                  onPress={() =>
                    openContactPay(selectedContact.id, true, "request")
                  }
                  disabled={cashuIsBusy}
                  data-guide="chat-request"
                >
                  {t("requestPayment")}
                </Button>
              ) : null}
              <Button
                flex={1}
                variant="secondary"
                icon={isFeedbackContact ? "HeartHandshake" : "HandCoins"}
                onPress={() => openContactPay(selectedContact.id, true)}
                disabled={cashuIsBusy || !canStartPay}
                tooltip={!canStartPay ? t("payInsufficient") : undefined}
                data-guide="chat-pay"
              >
                {isFeedbackContact ? t("donate") : t("pay")}
              </Button>
            </Row>
          ) : null
        }
      >
        <ChatMessageEditor
          ref={composeInputRef}
          value={draft}
          onChange={setDraft}
          onCaretChange={setComposeCaret}
          onPasteImages={(files) => {
            if (canAttach) addChatAttachments(files);
          }}
          onSendShortcut={() => {
            if (isDesktop) void requestSend();
          }}
          placeholder={t("chatPlaceholder")}
          removeContactLabel={t("chatRemoveContactFromDraft")}
          trailing={
            showSend ? (
              <IconButton
                icon="Send"
                variant="primary"
                size="sm"
                accessibilityLabel={
                  editContext ? t("chatSaveAction") : t("send")
                }
                onPointerDown={keepEditorFocus}
                onPress={() => void requestSend()}
                disabled={!canSendChat}
                data-guide="chat-send"
              />
            ) : (
              <IconButton
                icon="Images"
                variant="secondary"
                size="sm"
                accessibilityLabel={t("chatImageAttach")}
                onPointerDown={keepEditorFocus}
                onPress={attachFiles}
                disabled={!canAttach}
              />
            )
          }
          disabled={!npub && !hasUnknownPubkeyHex}
          getCashuTokenMessageInfo={getCashuTokenMessageInfo}
          getMintIconUrl={getMintIconUrl}
          getNpubMessageContactInfo={getNpubMessageContactInfo}
        />
      </MessageComposerFrame>
    </Stack>
  );
});

const useChatViewport = (
  chatMessagesRef: React.RefObject<HTMLDivElement | null>,
  composeInputRef: React.RefObject<HTMLDivElement | null>,
  selectedContactId: string | null,
) => {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (typeof window === "undefined") return;
    if (!selectedContactId) return;

    const root = document.documentElement;
    const body = document.body;
    const pendingRefreshTimeouts = new Set<number>();
    let pendingViewportAnchor: ChatViewportAnchor | null = null;
    let pendingViewportAnchorFrame: number | null = null;
    let appliedViewportHeight: number | null = null;
    const getWindowScrollTop = () =>
      Math.max(
        window.scrollY,
        window.pageYOffset,
        document.documentElement.scrollTop,
        document.body.scrollTop,
      );
    const previousHtmlOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const updateViewportHeight = () => {
      // iOS can pan the document after focusin has already fired, especially
      // when reopening the keyboard. The chat owns its scrolling, so keep the
      // document itself pinned before applying visual viewport measurements.
      if (getWindowScrollTop() > 1) {
        window.scrollTo(0, 0);
      }
      const viewport = window.visualViewport;
      // During iOS keyboard animation innerHeight can shrink before the
      // fixed-position layout viewport does. Measure that viewport directly.
      const layoutHeight = root.clientHeight;
      const nextHeight = viewport?.height ?? layoutHeight;
      const nextOffsetTop = viewport?.offsetTop ?? 0;
      const visibleHeight = Math.min(
        layoutHeight,
        Math.max(0, nextHeight + nextOffsetTop),
      );
      const viewportKeyboardInset = Math.max(0, layoutHeight - visibleHeight);
      const rootStyles = getComputedStyle(root);
      const nativeKeyboardInset = Number.parseFloat(
        rootStyles.getPropertyValue("--native-keyboard-inset"),
      );
      // iOS standalone PWAs can report a visualViewport height short of
      // window.innerHeight even with the keyboard closed, so only trust the
      // viewport-derived inset while an editable element is focused.
      const active = document.activeElement;
      const keyboardCanBeOpen =
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA");
      const keyboardInset = Math.max(
        keyboardCanBeOpen ? viewportKeyboardInset : 0,
        Number.isFinite(nativeKeyboardInset) ? nativeKeyboardInset : 0,
      );
      const viewportHeight = Math.round(layoutHeight - keyboardInset);
      const viewportHeightChanged = appliedViewportHeight !== viewportHeight;

      if (viewportHeightChanged) {
        pendingViewportAnchor ??= captureChatViewportAnchor(
          chatMessagesRef.current,
        );
      }
      root.style.setProperty("--chat-viewport-height", `${viewportHeight}px`);
      if (keyboardInset > 0) {
        root.dataset.chatKeyboardOpen = "true";
      } else {
        delete root.dataset.chatKeyboardOpen;
      }

      appliedViewportHeight = viewportHeight;
      if (!viewportHeightChanged) return;

      if (pendingViewportAnchorFrame !== null) {
        window.cancelAnimationFrame(pendingViewportAnchorFrame);
      }
      pendingViewportAnchorFrame = window.requestAnimationFrame(() => {
        pendingViewportAnchorFrame = null;
        restoreChatViewportAnchor(
          chatMessagesRef.current,
          pendingViewportAnchor,
        );
        pendingViewportAnchor = null;
      });
    };

    const scheduleViewportRefresh = () => {
      updateViewportHeight();
      requestAnimationFrame(updateViewportHeight);

      for (const delayMs of [120, 280]) {
        const timeoutId = window.setTimeout(() => {
          pendingRefreshTimeouts.delete(timeoutId);
          updateViewportHeight();
        }, delayMs);
        pendingRefreshTimeouts.add(timeoutId);
      }
    };

    const handleComposeFocusChange = (event: FocusEvent) => {
      const input = composeInputRef.current;
      if (!input || event.target !== input) return;
      scheduleViewportRefresh();
    };

    updateViewportHeight();

    const viewport = window.visualViewport;
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("linky-native-window-insets", updateViewportHeight);
    document.addEventListener("focusin", handleComposeFocusChange);
    document.addEventListener("focusout", handleComposeFocusChange);
    viewport?.addEventListener("resize", updateViewportHeight);
    viewport?.addEventListener("scroll", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener(
        "linky-native-window-insets",
        updateViewportHeight,
      );
      document.removeEventListener("focusin", handleComposeFocusChange);
      document.removeEventListener("focusout", handleComposeFocusChange);
      viewport?.removeEventListener("resize", updateViewportHeight);
      viewport?.removeEventListener("scroll", updateViewportHeight);
      for (const timeoutId of pendingRefreshTimeouts) {
        window.clearTimeout(timeoutId);
      }
      if (pendingViewportAnchorFrame !== null) {
        window.cancelAnimationFrame(pendingViewportAnchorFrame);
      }
      root.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      root.style.removeProperty("--chat-viewport-height");
      delete root.dataset.chatKeyboardOpen;
    };
  }, [chatMessagesRef, composeInputRef, selectedContactId]);
};

interface UnknownContactWarningProps {
  onAdd: () => Promise<void>;
  onBlock: () => Promise<void>;
  t: Translate;
}

const UnknownContactWarning = memo(function UnknownContactWarning({
  onAdd,
  onBlock,
  t,
}: UnknownContactWarningProps) {
  return (
    <Stack paddingHorizontal="$xl" paddingTop="$sm">
      <Notice
        tone="accent"
        icon="Info"
        title={t("chatUnknownContactWarning")}
        description={
          <Row gap="$sm" paddingTop="$xs">
            <Button flex={1} onPress={() => void onAdd()}>
              {t("addContact")}
            </Button>
            <BlockContactButton flex={1} onConfirm={onBlock} t={t} />
          </Row>
        }
      />
    </Stack>
  );
});

const NEARBY_BANNER_KEYS = {
  nearby: "nearby",
  buy: "nearbyBuys",
  sell: "nearbySells",
} as const;

/** Edge to edge under the top bar while the peer's beacon is received. */
export const ChatNearbyBanner = memo(function ChatNearbyBanner({
  npub,
  t,
}: {
  npub: string | null;
  t: Translate;
}) {
  const state = useNearbyContact(npub ? parsePubkey(npub) : null);
  return state ? <NearbyBanner label={t(NEARBY_BANNER_KEYS[state])} /> : null;
});

export const ChatPage: FC<ChatPageProps> = ({
  cashuBalance,
  cashuBalanceAfterMelt,
  addChatAttachments,
  cashuIsBusy,
  chatAttachments,
  chatDraft,
  chatMessageElByIdRef,
  chatMessages,
  bankPaymentOfferMessages,
  chatMessagesRef,
  chatOwnPubkeyHex,
  chatSendIsBusy,
  editContext,
  feedbackContactNpub,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  lang,
  mentionContacts,
  onCancelEdit,
  onCancelReply,
  onAddUnknownContact,
  onAddNpubContacts,
  contactsGroupAssignment,
  onBlockUnknownContact,
  onCopy,
  onDeclinePaymentRequest,
  onEdit,
  onOpenNpubContact,
  onPayPaymentRequest,
  onSettleBankPaymentOffer,
  onReact,
  onReply,
  openContactPay,
  payWithCashuEnabled,
  reactionsByMessageId,
  replyContext,
  selectedContact,
  sendChatImage,
  removeChatAttachment,
  sendChatMessage,
  setChatDraft,
  markMintIconFailed,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const composeInputRef = useRef<HTMLDivElement | null>(null);
  const npub = selectedContact
    ? normalizeNpubIdentifier(selectedContact.npub ?? "")
    : null;
  const selectedContactId = selectedContact?.id ?? null;
  const hasUnknownPubkeyHex = Boolean(
    (selectedContact?.unknownPubkeyHex ?? "").trim(),
  );

  useChatViewport(chatMessagesRef, composeInputRef, selectedContactId);

  useEffect(() => {
    if (selectedContact?.isUnknownContact) return;

    const chatId = (selectedContact?.id ?? "").trim();
    if (!chatId) return;

    const nowSec = nowSeconds();
    let newestOffer: { offerId: string; updatedAtSec: number } | null = null;

    for (const message of bankPaymentOfferMessages) {
      if (message.contactId.trim() !== chatId) continue;
      if (message.direction !== "in") continue;

      const info = decodeBankPaymentOffer(message.content);
      if (!info || info.status !== "offered") continue;
      if (isBankPaymentOfferExpired(info, message.createdAtSec, nowSec)) {
        continue;
      }
      if (isBankPaymentOfferMinimized(chatId, info.offerId)) continue;

      const updatedAtSec = info.statusUpdatedAtSec ?? message.createdAtSec;
      if (!newestOffer || updatedAtSec > newestOffer.updatedAtSec) {
        newestOffer = { offerId: info.offerId, updatedAtSec };
      }
    }

    if (newestOffer) {
      navigateTo({
        route: "bankPaymentOffer",
        chatId,
        offerId: newestOffer.offerId,
      });
    }
  }, [
    bankPaymentOfferMessages,
    selectedContact?.id,
    selectedContact?.isUnknownContact,
  ]);

  const replyPreviewText = useMemo(() => {
    if (replyContext?.replyToContent) {
      return formatChatMessagePreviewText({
        content: replyContext.replyToContent,
        formatDisplayedAmountText,
        t,
      });
    }
    if (!replyContext?.replyToId) return "";

    const repliedMessage = chatMessages.find(
      (message) => (message.rumorId ?? "").trim() === replyContext.replyToId,
    );
    return formatChatMessagePreviewText({
      content: repliedMessage?.content ?? "",
      direction: repliedMessage?.direction ?? null,
      formatDisplayedAmountText,
      t,
    });
  }, [chatMessages, formatDisplayedAmountText, replyContext, t]);

  if (!selectedContact) {
    return <EmptyState title={t("contactNotFound")} />;
  }

  const ln = (selectedContact.lnAddress ?? "").trim();
  const isUnknownContact = Boolean(selectedContact.isUnknownContact);
  const canPayThisContact =
    !isUnknownContact &&
    (Boolean(ln) || (payWithCashuEnabled && Boolean(npub)));
  const canStartPay =
    (Boolean(ln) && cashuBalance > 0) || (Boolean(npub) && cashuBalance > 0);
  const canRequestThisContact =
    !isUnknownContact && Boolean(npub || hasUnknownPubkeyHex);
  const isFeedbackContact = npub === feedbackContactNpub;

  return (
    <Stack testID="chat-panel" flex={1} minHeight={0} gap="$none">
      <ChatNearbyBanner npub={npub} t={t} />
      {isUnknownContact ? (
        <UnknownContactWarning
          onAdd={onAddUnknownContact}
          onBlock={onBlockUnknownContact}
          t={t}
        />
      ) : null}

      {!npub && !hasUnknownPubkeyHex && (
        <Stack paddingHorizontal="$xl" paddingTop="$sm">
          <Notice tone="accent" title={t("chatMissingContactNpub")} />
        </Stack>
      )}

      <ChatMessageList
        bankPaymentOfferMessages={bankPaymentOfferMessages}
        canOpenBankPaymentOfferDetails={!isUnknownContact}
        cashuBalanceAfterMelt={cashuBalanceAfterMelt}
        cashuIsBusy={cashuIsBusy}
        chatMessageElByIdRef={chatMessageElByIdRef}
        chatMessages={chatMessages}
        chatMessagesRef={chatMessagesRef}
        chatOwnPubkeyHex={chatOwnPubkeyHex}
        formatDisplayedAmountText={formatDisplayedAmountText}
        getCashuTokenMessageInfo={getCashuTokenMessageInfo}
        getMintIconUrl={getMintIconUrl}
        getNpubMessageContactInfo={getNpubMessageContactInfo}
        lang={lang}
        onCopy={onCopy}
        onAddNpubContacts={onAddNpubContacts}
        contactsGroupAssignment={contactsGroupAssignment}
        onDeclinePaymentRequest={onDeclinePaymentRequest}
        onEdit={onEdit}
        onOpenNpubContact={onOpenNpubContact}
        onPayPaymentRequest={onPayPaymentRequest}
        onSettleBankPaymentOffer={onSettleBankPaymentOffer}
        onReact={onReact}
        onReply={onReply}
        peerSeenSinceSec={selectedContact.chatPeerSeenSinceSec ?? 0}
        peerSeenUpToSec={selectedContact.chatPeerSeenAtSec ?? 0}
        reactionsByMessageId={reactionsByMessageId}
        selectedContactId={selectedContact.id}
        markMintIconFailed={markMintIconFailed}
        t={t}
      />

      <ChatComposer
        canPayThisContact={canPayThisContact}
        canRequestThisContact={canRequestThisContact}
        canStartPay={canStartPay}
        addChatAttachments={addChatAttachments}
        cashuIsBusy={cashuIsBusy}
        chatAttachments={chatAttachments}
        chatDraft={chatDraft}
        chatSendIsBusy={chatSendIsBusy}
        composeInputRef={composeInputRef}
        editContext={editContext}
        getCashuTokenMessageInfo={getCashuTokenMessageInfo}
        getMintIconUrl={getMintIconUrl}
        getNpubMessageContactInfo={getNpubMessageContactInfo}
        hasUnknownPubkeyHex={hasUnknownPubkeyHex}
        isFeedbackContact={isFeedbackContact}
        mentionContacts={mentionContacts}
        npub={npub}
        onCancelEdit={onCancelEdit}
        onCancelReply={onCancelReply}
        openContactPay={openContactPay}
        replyContext={replyContext}
        replyPreviewText={replyPreviewText}
        selectedContact={selectedContact}
        sendChatImage={sendChatImage}
        sendChatMessage={sendChatMessage}
        removeChatAttachment={removeChatAttachment}
        setChatDraft={setChatDraft}
        t={t}
      />
    </Stack>
  );
};
