import { useMintIcons } from "../app/hooks/mint/useMintInfo";
import { useReceivedSatByRequestId } from "../app/hooks/wallet/useReceivedSatByRequestId";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";
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
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  useChatContact,
  useMentionContacts,
  useNpubMessageContactInfo,
} from "../app/hooks/contacts/useDisplayContacts";
import {
  useNpubMessageContacts,
  useOpenContactPay,
  useOpenNpubMessageContact,
  useUnknownSenderActions,
} from "../app/hooks/contacts/useContactActions";
import { useChatScroll } from "../app/hooks/messages/chatScroll";
import {
  useChatComposer,
  useChatDelete,
  useChatMessages,
  useChatReactions,
  useChatSend,
  useCopyChatMessage,
} from "../app/hooks/messages/useChat";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useCashuTokenMessageInfo,
  useWalletBalance,
} from "../app/hooks/wallet/useWalletInventory";
import { currentPubkeyAtom } from "../app/state/session/session";
import { payWithCashuEnabledAtom } from "../app/state/wallet/prefs";
import type { Route } from "../types/route";
import { FEEDBACK_CONTACT_NPUB } from "../utils/constants";
import { useNearbyContact } from "../app/hooks/useBeacon";
import { aggregateReactions } from "../app/hooks/messages/chatReactions";
import type { EditChatContext } from "../app/hooks/messages/useEditChatMessage";
import type { ReplyContext } from "../app/hooks/messages/useSendChatMessage";
import {
  type BankPaymentOfferInfo,
  decodeBankPaymentOffer,
} from "@linky-fit/proxy-payment";
import {
  isBankPaymentOfferMinimized,
  setBankPaymentOfferMinimized,
} from "../app/lib/bankPaymentOfferStorage";
import { bankPaymentOfferToOpen } from "../app/lib/bankPaymentOfferRows";
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
import {
  paymentRequestAnswersByRumorId,
  type PaymentRequestStatus,
  type ReceivedSatByRequestId,
} from "../app/lib/paymentRequestStatus";
import { parsePrivateImageMessage } from "../app/lib/privateImageMessage";
import {
  getCashuTokenMessageInfo as readCashuTokenMessageInfo,
  type CashuTokenMessageInfo,
} from "../app/lib/tokenMessageInfo";
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
import { boundedMemo } from "../utils/boundedMemo";
import { pickFiles } from "../utils/pickFile";
import { nowSeconds } from "../utils/time";
import { isDeletedMessage } from "../app/lib/deletedMessage";

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
  onDelete: (message: LocalNostrMessage) => void;
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
  reactionsByMessageId: ReadonlyMap<string, LocalNostrReaction[]>;
  receivedSatByRequestId: ReceivedSatByRequestId;
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
  /** The row may show a token, so the wallet's token state can change it. */
  hasCashuText: boolean;
  /** The row may show an npub, so the contacts can change it. */
  hasNpubText: boolean;
  isCashuToken: boolean;
  paymentRequestInfo: CashuPaymentRequestMessageInfo | null;
  privateImageInfo: ReturnType<typeof parsePrivateImageMessage>;
}

// Content never changes in place, so a conversation's rows keep their parsed parts across renders.
const parseChatMessageContent = boundedMemo(
  (content: string): ParsedChatMessage => {
    const isCashuToken = readCashuTokenMessageInfo(content) !== null;
    return {
      bankPaymentOfferInfo: decodeBankPaymentOffer(content),
      declineInfo: parseLinkyPaymentRequestDeclineMessage(content),
      hasCashuText: isCashuToken || /cashu/i.test(content),
      hasNpubText: /npub1/i.test(content),
      isCashuToken,
      paymentRequestInfo: parseCashuPaymentRequestMessage(content),
      privateImageInfo: parsePrivateImageMessage(content),
    };
  },
  5_000,
);

const NO_REACTIONS: readonly ChatReactionChip[] = [];

const chipsByReactions = new WeakMap<
  readonly LocalNostrReaction[],
  { ownPubkeyHex: string | null; chips: readonly ChatReactionChip[] }
>();

const reactionChipsFor = (
  reactions: readonly LocalNostrReaction[] | undefined,
  ownPubkeyHex: string | null,
): readonly ChatReactionChip[] => {
  if (!reactions) return NO_REACTIONS;
  const cached = chipsByReactions.get(reactions);
  if (cached?.ownPubkeyHex === ownPubkeyHex) return cached.chips;
  const chips = aggregateReactions(reactions, ownPubkeyHex);
  chipsByReactions.set(reactions, { ownPubkeyHex, chips });
  return chips;
};

// A row whose text has no token or npub never asks for one, so it gets these
// instead of getters that change with the wallet and the contacts.
const noTokenInfo = (): CashuTokenMessageInfo | null => null;
const noNpubInfo = (): NpubMessageContactInfo | null => null;
const noMintIcon = (): MintIcon => ({
  failed: false,
  host: null,
  origin: null,
  url: null,
});

const openBankPaymentOfferDetails = (
  message: LocalNostrMessage,
  offer: BankPaymentOfferInfo,
) => {
  const offerId = offer.offerId.trim();
  const chatId = message.contactId.trim();
  if (!offerId || !chatId) return;
  setBankPaymentOfferMinimized(chatId, offerId, false);
  navigateTo({ route: "bankPaymentOffer", chatId, offerId });
};

interface ChatMessageViewModel extends ParsedChatMessage {
  bankPaymentOfferPeerNotice: BankPaymentOfferPeerNotice | null;
  canActOnPaymentRequest: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canReplyOrReact: boolean;
  canSettleBankPaymentOffer: boolean;
  isSeen: boolean;
  message: LocalNostrMessage;
  nextMessage: LocalNostrMessage | null;
  payPaymentRequestDisabled: boolean;
  paymentRequestStatus: PaymentRequestStatus | null;
  previousMessage: LocalNostrMessage | null;
  reactions: readonly ChatReactionChip[];
  replyQuoteText: string | null;
}

const buildBankPaymentOfferIndex = (
  messages: LocalNostrMessage[],
): Map<string, IndexedBankPaymentOffer[]> => {
  const byOfferId = new Map<string, IndexedBankPaymentOffer[]>();

  for (const message of messages) {
    const info = parseChatMessageContent(message.content).bankPaymentOfferInfo;
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
  onDelete: ChatPageProps["onDelete"];
  onAddNpubContacts: ChatPageProps["onAddNpubContacts"];
  contactsGroupAssignment: ChatPageProps["contactsGroupAssignment"];
  onDeclinePaymentRequest: (message: LocalNostrMessage) => void;
  onEdit: ChatPageProps["onEdit"];
  onOpenNpubContact: ChatPageProps["onOpenNpubContact"];
  onPayPaymentRequest: (
    message: LocalNostrMessage,
    requestInfo: CashuPaymentRequestMessageInfo,
  ) => void;
  onReact: ChatPageProps["onReact"];
  onReply: ChatPageProps["onReply"];
  onSettleBankPaymentOffer: ChatPageProps["onSettleBankPaymentOffer"];
  markMintIconFailed: ChatPageProps["markMintIconFailed"];
  /** Peer's reported seen window; 0 bounds mean no receipt yet. */
  peerSeenSinceSec: number;
  peerSeenUpToSec: number;
  reactionsByMessageId: ReadonlyMap<string, LocalNostrReaction[]>;
  receivedSatByRequestId: ReceivedSatByRequestId;
  selectedContactId: string;
  t: Translate;
}

type MessageRowActions = Pick<
  ChatMessageListProps,
  | "markMintIconFailed"
  | "onAddNpubContacts"
  | "onCopy"
  | "onDeclinePaymentRequest"
  | "onDelete"
  | "onEdit"
  | "onOpenNpubContact"
  | "onPayPaymentRequest"
  | "onReact"
  | "onReply"
  | "onSettleBankPaymentOffer"
>;

/** The row actions with a lasting identity, so a message row re-renders only when what it shows changes. */
const useStableRowActions = (actions: MessageRowActions): MessageRowActions => {
  const latest = useLatest(actions);
  return useMemo(
    () => ({
      markMintIconFailed: (url) => latest.current.markMintIconFailed(url),
      onAddNpubContacts: (npubs, messageId) =>
        latest.current.onAddNpubContacts(npubs, messageId),
      onCopy: (message) => latest.current.onCopy(message),
      onDeclinePaymentRequest: (message) =>
        latest.current.onDeclinePaymentRequest(message),
      onDelete: (message) => latest.current.onDelete(message),
      onEdit: (message) => latest.current.onEdit(message),
      onOpenNpubContact: (npub) => latest.current.onOpenNpubContact(npub),
      onPayPaymentRequest: (message, requestInfo) =>
        latest.current.onPayPaymentRequest(message, requestInfo),
      onReact: (message, emoji) => latest.current.onReact(message, emoji),
      onReply: (message) => latest.current.onReply(message),
      onSettleBankPaymentOffer: (message) =>
        latest.current.onSettleBankPaymentOffer(message),
    }),
    [latest],
  );
};

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
  onDelete,
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
  receivedSatByRequestId,
  selectedContactId,
  t,
}: ChatMessageListProps) {
  const actionLabels = useMemo(
    () => ({
      copy: t("copy"),
      delete: t("chatDeleteAction"),
      deleted: t("chatMessageDeleted"),
      edit: t("chatEditAction"),
      edited: t("chatEdited"),
      emojiGroups: {
        smileysAndPeople: t("chatEmojiGroupSmileysAndPeople"),
        animalsAndNature: t("chatEmojiGroupAnimalsAndNature"),
        foodAndDrink: t("chatEmojiGroupFoodAndDrink"),
        activities: t("chatEmojiGroupActivities"),
        travelAndPlaces: t("chatEmojiGroupTravelAndPlaces"),
        objects: t("chatEmojiGroupObjects"),
        symbols: t("chatEmojiGroupSymbols"),
        flags: t("chatEmojiGroupFlags"),
      },
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
    for (const message of chatMessages) {
      const rumorId = (message.rumorId ?? "").trim();
      if (rumorId) byRumorId.set(rumorId, message);
    }

    const requestAnswerByRumorId = paymentRequestAnswersByRumorId(
      chatMessages,
      receivedSatByRequestId,
    );

    const offersById = buildBankPaymentOfferIndex(bankPaymentOfferMessages);

    return chatMessages.map((message, index) => {
      const parsed = parseChatMessageContent(message.content);
      const rumorId = (message.rumorId ?? "").trim();
      const createdAtSec = message.createdAtSec || 0;
      const isSeen =
        message.direction === "out" &&
        createdAtSec > peerSeenSinceSec &&
        createdAtSec <= peerSeenUpToSec;
      const paymentRequestStatus: PaymentRequestStatus =
        requestAnswerByRumorId.get(rumorId) ?? "requested";
      const replyToId = (message.replyToId ?? "").trim();
      const fallbackReplyContent =
        (message.replyToContent ?? "").trim() || null;
      const repliedMessage = replyToId ? byRumorId.get(replyToId) : null;
      const isDeleted = isDeletedMessage(message);
      const replyQuoteText = replyToId
        ? formatChatMessagePreviewText({
            content: repliedMessage?.content ?? fallbackReplyContent ?? "",
            deleted: repliedMessage ? isDeletedMessage(repliedMessage) : false,
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
          !isDeleted &&
          !parsed.isCashuToken &&
          !parsed.paymentRequestInfo &&
          !parsed.privateImageInfo &&
          !parsed.bankPaymentOfferInfo &&
          !parsed.declineInfo,
        canDelete:
          Boolean(rumorId) &&
          !isDeleted &&
          !parsed.isCashuToken &&
          !parsed.paymentRequestInfo &&
          !parsed.bankPaymentOfferInfo &&
          !parsed.declineInfo,
        canReplyOrReact: Boolean(rumorId) && !isDeleted,
        canSettleBankPaymentOffer,
        isSeen,
        message,
        nextMessage:
          index + 1 < chatMessages.length ? chatMessages[index + 1] : null,
        payPaymentRequestDisabled:
          !parsed.paymentRequestInfo ||
          cashuIsBusy ||
          // An amountless request still takes at least one sat.
          (parsed.paymentRequestInfo.amount ?? 1) > cashuBalanceAfterMelt,
        paymentRequestStatus: parsed.paymentRequestInfo
          ? paymentRequestStatus
          : null,
        previousMessage: index > 0 ? chatMessages[index - 1] : null,
        reactions: rumorId
          ? reactionChipsFor(
              reactionsByMessageId.get(rumorId),
              chatOwnPubkeyHex,
            )
          : NO_REACTIONS,
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
    peerSeenSinceSec,
    peerSeenUpToSec,
    reactionsByMessageId,
    receivedSatByRequestId,
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
              getCashuTokenMessageInfo={
                viewModel.hasCashuText ? getCashuTokenMessageInfo : noTokenInfo
              }
              getMintIconUrl={
                viewModel.hasCashuText ? getMintIconUrl : noMintIcon
              }
              getNpubMessageContactInfo={
                viewModel.hasNpubText ? getNpubMessageContactInfo : noNpubInfo
              }
              onMintIconError={markMintIconFailed}
              actionLabels={actionLabels}
              canDelete={viewModel.canDelete}
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
              onOpenBankPaymentOfferDetails={openBankPaymentOfferDetails}
              onDeclinePaymentRequest={onDeclinePaymentRequest}
              onPayPaymentRequest={onPayPaymentRequest}
              onSettleBankPaymentOffer={onSettleBankPaymentOffer}
              canActOnPaymentRequest={viewModel.canActOnPaymentRequest}
              payPaymentRequestDisabled={viewModel.payPaymentRequestDisabled}
              payPaymentRequestBusy={
                viewModel.paymentRequestInfo ? cashuIsBusy : false
              }
              replyQuoteText={viewModel.replyQuoteText}
              settleBankPaymentOfferBusy={
                viewModel.bankPaymentOfferInfo ? cashuIsBusy : false
              }
              onCopy={onCopy}
              onDelete={onDelete}
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
  // Keeps the editor focused, and the iOS keyboard open, while tapping composer
  // controls. React Native's pointer events have no preventDefault.
  const keepEditorFocus = (event: React.PointerEvent) => {
    if (typeof event.preventDefault === "function") event.preventDefault();
  };
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
  onDelete,
  onEdit,
  onOpenNpubContact,
  onPayPaymentRequest,
  onSettleBankPaymentOffer,
  onReact,
  onReply,
  openContactPay,
  payWithCashuEnabled,
  reactionsByMessageId,
  receivedSatByRequestId,
  replyContext,
  selectedContact,
  sendChatImage,
  removeChatAttachment,
  sendChatMessage,
  setChatDraft,
  markMintIconFailed,
}) => {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const composeInputRef = useRef<HTMLDivElement | null>(null);
  const rowActions = useStableRowActions({
    markMintIconFailed,
    onAddNpubContacts,
    onCopy,
    onDeclinePaymentRequest: (message) => {
      void onDeclinePaymentRequest(message);
    },
    onDelete,
    onEdit,
    onOpenNpubContact,
    onPayPaymentRequest: (message, requestInfo) => {
      void onPayPaymentRequest(message, requestInfo);
    },
    onReact,
    onReply,
    onSettleBankPaymentOffer,
  });
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

    const offerId = bankPaymentOfferToOpen(
      bankPaymentOfferMessages,
      chatId,
      nowSeconds(),
      (id) => isBankPaymentOfferMinimized(chatId, id),
    );
    if (offerId) {
      navigateTo({ route: "bankPaymentOffer", chatId, offerId });
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
      deleted: repliedMessage ? isDeletedMessage(repliedMessage) : false,
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
        {...rowActions}
        contactsGroupAssignment={contactsGroupAssignment}
        peerSeenSinceSec={selectedContact.chatPeerSeenSinceSec ?? 0}
        peerSeenUpToSec={selectedContact.chatPeerSeenAtSec ?? 0}
        reactionsByMessageId={reactionsByMessageId}
        receivedSatByRequestId={receivedSatByRequestId}
        selectedContactId={selectedContact.id}
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

export const ChatRoute: FC<{ route: Route }> = ({ route }) => {
  const { getMintIconUrl, markMintIconFailed } = useMintIcons();
  const { payChatPaymentRequest, settleBankPaymentOffer } = useWalletCommands();
  const { lang } = useTranslation();
  const selectedContact = useChatContact(route);
  const composer = useChatComposer();
  const send = useChatSend(route, selectedContact);
  const { onReactToChatMessage, reactionsByMessageId } = useChatReactions(
    route,
    selectedContact,
  );
  const onCopy = useCopyChatMessage();
  const onDelete = useChatDelete(selectedContact);
  const { addUnknownContactFromChat, blockUnknownContactFromChat } =
    useUnknownSenderActions(route, selectedContact);
  const { addNpubMessageContacts, contactsGroupAssignment } =
    useNpubMessageContacts();
  const { bankPaymentOfferMessages, chatMessages } = useChatMessages(route);
  const { chatMessageElByIdRef, chatMessagesRef } = useChatScroll();
  const { cashuBalance, cashuBalanceAfterMelt, cashuIsBusy } =
    useWalletBalance();
  const chatOwnPubkeyHex = useAtomValue(currentPubkeyAtom);
  const payWithCashuEnabled = useAtomValue(payWithCashuEnabledAtom);
  const getCashuTokenMessageInfo = useCashuTokenMessageInfo();
  const getNpubMessageContactInfo = useNpubMessageContactInfo();
  const mentionContacts = useMentionContacts();
  const onOpenNpubContact = useOpenNpubMessageContact();
  const openContactPay = useOpenContactPay();
  const receivedSatByRequestId = useReceivedSatByRequestId();
  return (
    <ChatPage
      addChatAttachments={composer.addChatAttachments}
      bankPaymentOfferMessages={bankPaymentOfferMessages}
      cashuBalance={cashuBalance}
      cashuBalanceAfterMelt={cashuBalanceAfterMelt}
      cashuIsBusy={cashuIsBusy}
      chatAttachments={composer.chatAttachments}
      chatDraft={composer.chatDraft}
      chatMessageElByIdRef={chatMessageElByIdRef}
      chatMessages={chatMessages}
      chatMessagesRef={chatMessagesRef}
      chatOwnPubkeyHex={chatOwnPubkeyHex}
      chatSendIsBusy={composer.chatSendIsBusy}
      contactsGroupAssignment={contactsGroupAssignment}
      editContext={composer.editContext}
      feedbackContactNpub={FEEDBACK_CONTACT_NPUB}
      getCashuTokenMessageInfo={getCashuTokenMessageInfo}
      getMintIconUrl={getMintIconUrl}
      getNpubMessageContactInfo={getNpubMessageContactInfo}
      lang={lang}
      markMintIconFailed={markMintIconFailed}
      mentionContacts={mentionContacts}
      onAddNpubContacts={addNpubMessageContacts}
      onAddUnknownContact={addUnknownContactFromChat}
      onBlockUnknownContact={blockUnknownContactFromChat}
      onCancelEdit={composer.onCancelEdit}
      onCancelReply={composer.onCancelReply}
      onCopy={onCopy}
      onDeclinePaymentRequest={send.onDeclineChatPaymentRequest}
      onDelete={onDelete}
      onEdit={composer.onEditChatMessage}
      onOpenNpubContact={onOpenNpubContact}
      onPayPaymentRequest={payChatPaymentRequest}
      onReact={onReactToChatMessage}
      onReply={composer.onReplyToChatMessage}
      onSettleBankPaymentOffer={settleBankPaymentOffer}
      openContactPay={openContactPay}
      payWithCashuEnabled={payWithCashuEnabled}
      reactionsByMessageId={reactionsByMessageId}
      receivedSatByRequestId={receivedSatByRequestId}
      removeChatAttachment={composer.removeChatAttachment}
      replyContext={composer.replyContext}
      selectedContact={selectedContact}
      sendChatImage={send.sendChatImage}
      sendChatMessage={send.sendChatOrEditMessage}
      setChatDraft={composer.setChatDraft}
    />
  );
};
