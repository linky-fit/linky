import React from "react";
import type { Route } from "../../../types/route";
import { getLinkyBankPaymentOfferInfo } from "../../lib/bankPaymentOffer";
import { parseCashuPaymentRequestMessage } from "../../lib/paymentRequestMessage";
import { parsePrivateImageMessage } from "../../lib/privateImageMessage";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";

interface UseChatMessageEffectsParams<TContact extends ContactRowLike> {
  autoAcceptedChatMessageIdsRef: React.MutableRefObject<Set<string>>;
  cashuIsBusy: boolean;
  cashuTokensHydratedRef: React.MutableRefObject<boolean>;
  chatDidInitialScrollForContactRef: React.MutableRefObject<string | null>;
  chatForceScrollToBottomRef: React.MutableRefObject<boolean>;
  chatLastMessageCountRef: React.MutableRefObject<Record<string, number>>;
  chatMessageElByIdRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
  chatMessages: LocalNostrMessage[];
  chatMessagesRef: React.RefObject<HTMLDivElement | null>;
  chatScrollTargetIdRef: React.MutableRefObject<string | null>;
  getCashuTokenMessageInfo: (
    text: string,
  ) => { isValid: boolean; tokenRaw: string } | null;
  isCashuTokenKnownAny: (tokenRaw: string) => boolean;
  isCashuTokenStored: (tokenRaw: string) => boolean;
  nostrMessagesRecent: readonly LocalNostrMessage[];
  route: Route;
  saveCashuFromText: (
    text: string,
    options?: {
      contactId?: string;
      navigateToTokens?: boolean;
      navigateToWallet?: boolean;
      requestId?: string;
    },
  ) => Promise<void>;
  selectedContact: TContact | null;
}

export const useChatMessageEffects = <TContact extends ContactRowLike>({
  autoAcceptedChatMessageIdsRef,
  cashuIsBusy,
  cashuTokensHydratedRef,
  chatDidInitialScrollForContactRef,
  chatForceScrollToBottomRef,
  chatLastMessageCountRef,
  chatMessageElByIdRef,
  chatMessages,
  chatMessagesRef,
  chatScrollTargetIdRef,
  getCashuTokenMessageInfo,
  isCashuTokenKnownAny,
  isCashuTokenStored,
  nostrMessagesRecent,
  route,
  saveCashuFromText,
  selectedContact,
}: UseChatMessageEffectsParams<TContact>) => {
  const requestIdByMessageRumorId = React.useMemo(() => {
    const byRumorId = new Map<string, string>();

    for (const message of [...nostrMessagesRecent, ...chatMessages]) {
      const rumorId = (message.rumorId ?? "").trim();
      if (!rumorId) continue;

      const requestInfo = parseCashuPaymentRequestMessage(message.content);
      const requestId = (requestInfo?.requestId ?? "").trim();
      if (!requestId) continue;

      byRumorId.set(rumorId, requestId);
    }

    return byRumorId;
  }, [chatMessages, nostrMessagesRecent]);

  const getRequestIdForPaymentReply = React.useCallback(
    (message: LocalNostrMessage): string | null => {
      const replyToId = (message.replyToId ?? "").trim();
      if (replyToId) {
        return requestIdByMessageRumorId.get(replyToId) ?? null;
      }

      const rootMessageId = (message.rootMessageId ?? "").trim();
      if (rootMessageId) {
        return requestIdByMessageRumorId.get(rootMessageId) ?? null;
      }

      return null;
    },
    [requestIdByMessageRumorId],
  );

  const autoAcceptCashuTokenFromMessages = React.useCallback(
    (messages: readonly LocalNostrMessage[], newestFirst: boolean): void => {
      const candidates = newestFirst ? [...messages].reverse() : messages;

      for (const message of candidates) {
        const id = message.id;
        if (!id) continue;
        if (autoAcceptedChatMessageIdsRef.current.has(id)) continue;
        if (message.direction !== "in") continue;

        const content = message.content;
        if (getLinkyBankPaymentOfferInfo(content)) continue;
        if (parsePrivateImageMessage(content)) continue;

        const info = getCashuTokenMessageInfo(content);
        if (!info) continue;

        autoAcceptedChatMessageIdsRef.current.add(id);
        if (!info.isValid) continue;
        if (isCashuTokenKnownAny(info.tokenRaw)) continue;
        if (isCashuTokenStored(info.tokenRaw)) continue;

        const requestId = getRequestIdForPaymentReply(message);
        const contactId = message.contactId.trim();
        void saveCashuFromText(info.tokenRaw, {
          ...(contactId ? { contactId } : {}),
          ...(requestId ? { requestId } : {}),
        });
        return;
      }
    },
    [
      autoAcceptedChatMessageIdsRef,
      getCashuTokenMessageInfo,
      getRequestIdForPaymentReply,
      isCashuTokenKnownAny,
      isCashuTokenStored,
      saveCashuFromText,
    ],
  );

  React.useEffect(() => {
    // Auto-accept Cashu tokens received from others into the wallet.
    if (route.kind !== "chat") return;
    if (cashuIsBusy) return;
    if (!cashuTokensHydratedRef.current) return;
    autoAcceptCashuTokenFromMessages(chatMessages, true);
  }, [
    autoAcceptCashuTokenFromMessages,
    cashuIsBusy,
    chatMessages,
    route.kind,
    cashuTokensHydratedRef,
  ]);

  React.useEffect(() => {
    // Auto-accept Cashu tokens from incoming messages even when chat isn't open.
    if (cashuIsBusy) return;
    if (!cashuTokensHydratedRef.current) return;
    autoAcceptCashuTokenFromMessages(nostrMessagesRecent, false);
  }, [
    autoAcceptCashuTokenFromMessages,
    cashuIsBusy,
    nostrMessagesRecent,
    cashuTokensHydratedRef,
  ]);

  React.useEffect(() => {
    if (route.kind !== "chat") {
      chatDidInitialScrollForContactRef.current = null;
    }
  }, [route.kind, chatDidInitialScrollForContactRef]);

  React.useEffect(() => {
    // Scroll chat to newest message on open.
    if (route.kind !== "chat") return;
    if (!selectedContact) return;

    const routeContactId = route.id.trim();
    if (!routeContactId) return;

    const contactId = (selectedContact.id ?? "").trim();
    if (!contactId) return;
    if (contactId !== routeContactId) return;

    const container = chatMessagesRef.current;
    if (!container) return;

    const last = chatMessages.length
      ? chatMessages[chatMessages.length - 1]
      : null;
    if (!last) return;

    const prevCount = chatLastMessageCountRef.current[routeContactId] ?? 0;
    chatLastMessageCountRef.current[routeContactId] = chatMessages.length;

    const firstForThisContact =
      chatDidInitialScrollForContactRef.current !== routeContactId;

    if (firstForThisContact) {
      chatDidInitialScrollForContactRef.current = routeContactId;

      const target = last;
      const targetId = target.id;

      const tryScroll = (attempt: number) => {
        const el = targetId ? chatMessageElByIdRef.current.get(targetId) : null;
        if (el) {
          el.scrollIntoView({ block: "end" });
          return;
        }
        if (attempt < 6) {
          requestAnimationFrame(() => tryScroll(attempt + 1));
          return;
        }
        const chatContainer = chatMessagesRef.current;
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
      };

      requestAnimationFrame(() => {
        tryScroll(0);
      });
      return;
    }

    if (chatForceScrollToBottomRef.current) {
      const targetId = chatScrollTargetIdRef.current;

      const tryScroll = (attempt: number) => {
        if (targetId) {
          const el = chatMessageElByIdRef.current.get(targetId);
          if (el) {
            el.scrollIntoView({ block: "end" });
            chatScrollTargetIdRef.current = null;
            chatForceScrollToBottomRef.current = false;
            return;
          }
        }

        const chatContainer = chatMessagesRef.current;
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;

        if (attempt < 6) {
          requestAnimationFrame(() => tryScroll(attempt + 1));
          return;
        }

        chatScrollTargetIdRef.current = null;
        chatForceScrollToBottomRef.current = false;
      };

      requestAnimationFrame(() => tryScroll(0));
      return;
    }

    if (chatMessages.length > prevCount) {
      const isOut = last.direction === "out";
      if (isOut) {
        requestAnimationFrame(() => {
          const chatContainer = chatMessagesRef.current;
          if (chatContainer)
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
        return;
      }
    }

    // Keep pinned to bottom if already near bottom.
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 120) {
      requestAnimationFrame(() => {
        const chatContainer = chatMessagesRef.current;
        if (!chatContainer) return;
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    }
  }, [
    route,
    selectedContact,
    chatMessages,
    chatMessagesRef,
    chatLastMessageCountRef,
    chatDidInitialScrollForContactRef,
    chatMessageElByIdRef,
    chatForceScrollToBottomRef,
    chatScrollTargetIdRef,
  ]);
};
