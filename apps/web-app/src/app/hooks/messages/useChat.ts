import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import type { Route } from "../../../types/route";
import { mergeBankPaymentOffersIntoChatMessages } from "../../lib/bankPaymentOfferRows";
import { buildLinkyPaymentRequestDeclineMessage } from "../../lib/paymentRequestMessage";
import {
  getChatAttachmentRejection,
  parsePrivateImageMessage,
  privateImagePreviewText,
} from "../../lib/privateImageMessage";
import {
  chatAttachmentsAtom,
  chatDraftAtom,
  chatSendBusyAtom,
  editContextAtom,
  replyContextAtom,
} from "../../state/messages/chat";
import { chatWritesAtom } from "../../state/messages/chatWrites";
import { bankPaymentOfferMessagesAtom } from "../../state/messages/bankOffers";
import {
  chatMessagesFor,
  messagesByContactAtom,
  reactionsByMessageIdAtom,
} from "../../state/messages/readModel";
import { currentNsecAtom } from "../../state/session/session";
import type {
  ContactIdentityRowLike,
  LocalNostrMessage,
} from "../../types/appTypes";
import { useCopyText, useSetStatus, useTranslation } from "../shell";
import {
  useConversationsRepository,
  useUnknownSendersRepository,
} from "../useLinksync";
import { useChatScroll } from "./chatScroll";
import { useEditChatMessage } from "./useEditChatMessage";
import { useMessageWrites } from "./useMessageWrites";
import { useSendChatMessage } from "./useSendChatMessage";
import { useSendReaction } from "./useSendReaction";

/** On the chat route, the conversation with the peer's proxy payment offers merged in. */
export const withChatOffers = (
  route: Route,
  chatMessages: LocalNostrMessage[],
  bankPaymentOfferMessages: readonly LocalNostrMessage[],
): LocalNostrMessage[] => {
  if (route.kind !== "chat") return chatMessages;
  const activeContactId = route.id.trim();
  const offerMessages = bankPaymentOfferMessages.filter(
    (message) => message.contactId === activeContactId,
  );
  return offerMessages.length === 0
    ? chatMessages
    : mergeBankPaymentOffersIntoChatMessages(chatMessages, offerMessages);
};

/** The conversation the route shows, offers included on the chat route. */
export const useChatMessages = (route: Route) => {
  const messagesByContact = useAtomValue(messagesByContactAtom);
  const bankPaymentOfferMessages = useAtomValue(bankPaymentOfferMessagesAtom);
  const chatId =
    route.kind === "chat"
      ? route.id
      : route.kind === "bankPaymentOffer"
        ? route.chatId
        : null;
  const contactMessages = React.useMemo(
    () => chatMessagesFor(messagesByContact, chatId),
    [chatId, messagesByContact],
  );
  const chatMessages = React.useMemo(
    () => withChatOffers(route, contactMessages, bankPaymentOfferMessages),
    [bankPaymentOfferMessages, contactMessages, route],
  );
  return { bankPaymentOfferMessages, chatMessages };
};

/** The open conversation's composer: draft, attachments, and the reply or edit in progress. */
export const useChatComposer = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const [chatDraft, setChatDraft] = useAtom(chatDraftAtom);
  const [chatAttachments, setChatAttachments] = useAtom(chatAttachmentsAtom);
  const [replyContext, setReplyContext] = useAtom(replyContextAtom);
  const [editContext, setEditContext] = useAtom(editContextAtom);
  const chatSendIsBusy = useAtomValue(chatSendBusyAtom);

  const addChatAttachments = React.useCallback(
    (files: readonly File[]) => {
      const accepted: File[] = [];
      for (const file of files) {
        const rejectionKey = getChatAttachmentRejection(file);
        if (rejectionKey) setStatus(t(rejectionKey));
        else accepted.push(file);
      }
      if (accepted.length === 0) return;
      setChatAttachments((previous) => [...previous, ...accepted]);
    },
    [setChatAttachments, setStatus, t],
  );

  const removeChatAttachment = React.useCallback(
    (file: File) => {
      setChatAttachments((previous) =>
        previous.filter((candidate) => candidate !== file),
      );
    },
    [setChatAttachments],
  );

  const onReplyToChatMessage = React.useCallback(
    (message: LocalNostrMessage) => {
      const rumorId = (message.rumorId ?? "").trim();
      if (!rumorId) return;
      setEditContext(null);
      setReplyContext({
        replyToId: rumorId,
        rootMessageId: (message.rootMessageId ?? "").trim() || rumorId,
        replyToContent: message.content.trim() || null,
      });
    },
    [setEditContext, setReplyContext],
  );

  const onEditChatMessage = React.useCallback(
    (message: LocalNostrMessage) => {
      const isOut = message.direction === "out";
      if (!isOut) return;
      const rumorId = (message.rumorId ?? "").trim();
      if (!rumorId) return;
      const messageId = message.id.trim();
      if (!messageId) return;

      setReplyContext(null);
      const content = message.content;
      setEditContext({
        messageId,
        rumorId,
        originalContent:
          (message.originalContent ?? "").trim() || content || "",
      });
      setChatDraft(content);
    },
    [setChatDraft, setEditContext, setReplyContext],
  );

  const onCancelReply = React.useCallback(() => {
    setReplyContext(null);
  }, [setReplyContext]);

  const onCancelEdit = React.useCallback(() => {
    setEditContext(null);
    setChatDraft("");
  }, [setChatDraft, setEditContext]);

  return {
    addChatAttachments,
    chatAttachments,
    chatDraft,
    chatSendIsBusy,
    editContext,
    onCancelEdit,
    onCancelReply,
    onEditChatMessage,
    onReplyToChatMessage,
    removeChatAttachment,
    replyContext,
    setChatDraft,
  };
};

/** Sending, editing and declining in the conversation with `selectedContact`. */
export const useChatSend = <TContact extends ContactIdentityRowLike>(
  route: Route,
  selectedContact: TContact | null,
) => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const registry = React.useContext(RegistryContext);
  const chatWrites = useAtomSuspense(chatWritesAtom).value;
  const currentNsec = useAtomValue(currentNsecAtom);
  const [chatDraft, setChatDraft] = useAtom(chatDraftAtom);
  const [replyContext, setReplyContext] = useAtom(replyContextAtom);
  const [editContext, setEditContext] = useAtom(editContextAtom);
  const [chatSendIsBusy, setChatSendIsBusy] = useAtom(chatSendBusyAtom);
  const { triggerChatScrollToBottom } = useChatScroll();
  const readReplyContext = React.useCallback(
    () => registry.get(replyContextAtom),
    [registry],
  );

  const sendChatMessage = useSendChatMessage({
    appendLocalNostrMessage: chatWrites.appendLocalNostrMessage,
    chatDraft,
    chatSendIsBusy,
    currentNsec,
    route,
    replyContext,
    readReplyContext,
    selectedContact,
    setReplyContext,
    setChatDraft,
    setChatSendIsBusy,
    setStatus,
    t,
    triggerChatScrollToBottom,
    updateLocalNostrMessage: chatWrites.updateLocalNostrMessage,
  });

  const editChatMessage = useEditChatMessage({
    chatDraft,
    chatSendIsBusy,
    currentNsec,
    editContext,
    route,
    selectedContact,
    setChatDraft,
    setChatSendIsBusy,
    setEditContext,
    setStatus,
    t,
    updateLocalNostrMessage: chatWrites.updateLocalNostrMessage,
  });

  const sendChatOrEditMessage = React.useCallback(async () => {
    if (editContext) {
      await editChatMessage();
      return;
    }
    await sendChatMessage();
  }, [editChatMessage, editContext, sendChatMessage]);

  const sendChatImage = React.useCallback(
    async (file: File, replyToMessage?: LocalNostrMessage) => {
      if (editContext) return false;
      const replyToId = (replyToMessage?.rumorId ?? "").trim();
      const outcome = await sendChatMessage({
        clearDraft: false,
        clearReplyContext: true,
        imageFile: file,
        ...(replyToId
          ? {
              replyContext: {
                replyToId,
                rootMessageId:
                  (replyToMessage?.rootMessageId ?? "").trim() || replyToId,
                replyToContent: (replyToMessage?.content ?? "").trim() || null,
              },
            }
          : {}),
      });
      return outcome !== "failed";
    },
    [editContext, sendChatMessage],
  );

  const onDeclineChatPaymentRequest = React.useCallback(
    async (message: LocalNostrMessage) => {
      const requestRumorId = (message.rumorId ?? "").trim();
      if (!requestRumorId) return;

      await sendChatMessage({
        clearDraft: false,
        replyContext: {
          replyToId: requestRumorId,
          rootMessageId: (message.rootMessageId ?? "").trim() || requestRumorId,
          replyToContent: message.content.trim() || null,
        },
        text: buildLinkyPaymentRequestDeclineMessage(requestRumorId),
      });
    },
    [sendChatMessage],
  );

  return {
    onDeclineChatPaymentRequest,
    sendChatImage,
    sendChatMessage,
    sendChatOrEditMessage,
  };
};

/** Reacting to a message in the conversation with `selectedContact`. */
export const useChatReactions = <TContact extends ContactIdentityRowLike>(
  route: Route,
  selectedContact: TContact | null,
) => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const currentNsec = useAtomValue(currentNsecAtom);
  const reactionsByMessageId = useAtomValue(reactionsByMessageIdAtom);
  const {
    appendLocalNostrReaction,
    softDeleteLocalNostrReaction,
    updateLocalNostrReaction,
  } = useMessageWrites({
    conversations: useConversationsRepository(),
    unknownSenders: useUnknownSendersRepository(),
  });

  const sendReaction = useSendReaction({
    appendLocalNostrReaction,
    currentNsec,
    reactionsByMessageId,
    route,
    selectedContact,
    setStatus,
    softDeleteLocalNostrReaction,
    t,
    updateLocalNostrReaction,
  });

  const onReactToChatMessage = React.useCallback(
    (message: LocalNostrMessage, emoji: string) => {
      const messageRumorId = (message.rumorId ?? "").trim();
      const messageAuthorPubkey = message.pubkey.trim();
      if (!messageRumorId || !messageAuthorPubkey) return;
      void sendReaction({
        emoji,
        messageAuthorPubkey,
        messageRumorId,
        targetKind: parsePrivateImageMessage(message.content)
          ? "image"
          : "text",
      });
    },
    [sendReaction],
  );

  return { onReactToChatMessage, reactionsByMessageId };
};

/** Copies a message, a private image as its preview text. */
export const useCopyChatMessage = () => {
  const { t } = useTranslation();
  const copyText = useCopyText();
  return React.useCallback(
    (message: LocalNostrMessage) => {
      const content = message.content;
      const privateImage = parsePrivateImageMessage(content);
      const copyContent = privateImage
        ? privateImagePreviewText(t, privateImage)
        : content;
      void copyText(copyContent);
    },
    [copyText, t],
  );
};

/** Clears the composer's reply and edit, as leaving or switching conversations does. */
export const useResetChatContexts = () => {
  const setReplyContext = useAtomSet(replyContextAtom);
  const setEditContext = useAtomSet(editContextAtom);
  return React.useCallback(() => {
    setReplyContext(null);
    setEditContext(null);
  }, [setEditContext, setReplyContext]);
};
