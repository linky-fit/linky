import { useAtomValue } from "@linky-fit/linkstr-react";
import { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
import { transactionIdForRequest } from "@linky-fit/linksync";
import { decodeNpub, encodeNpub, parsePubkey } from "@linky-fit/linkstr";
import React from "react";
import { useExclusiveRun } from "../../../hooks/useExclusiveRun";
import { useLatest } from "../../../hooks/useLatest";
import { navigateTo, type useRouting } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { formatMintHost, normalizeMintUrl } from "../../../utils/mint";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { nowSeconds } from "../../../utils/time";
import { makeLocalId } from "../../../utils/validation";
import { isCurrentChatPaymentRequest } from "../../lib/chatPaymentRequestAuthorization";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "../../lib/paymentRequestMessage";
import type { ReplyContext } from "../../state/messages/chat";
import { allowTestMintsAtom } from "../../state/session/settings";
import type { PendingCashuPaymentRequest } from "../../state/shell/confirmations";
import { defaultMintAtom } from "../../state/wallet/defaultMint";
import {
  planPaymentRequestMint,
  sendFeeAllowance,
} from "../../state/wallet/paymentRequestPlan";
import { getMintFeePpk } from "../mint/mintInfoHelpers";
import type {
  ContactRowLike,
  LocalNostrMessage,
  LoggedPaymentEventParams,
} from "../../types/appTypes";
import type { useContactsMessagingComposition } from "../composition/useContactsMessagingComposition";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useRequestMintUrls } from "../mint/useRequestMintUrls";
import { useOwnNprofile } from "../useOwnNprofile";
import { useMintInfoByUrl, useTouchMintInfo } from "../mint/useMintInfo";
import {
  useCashuPaymentRequestConfirmation,
  type ReviewedCashuPaymentRequest,
  type UnpayableQuote,
} from "../payments/useCashuPaymentRequestConfirmation";
import { useReadNavIntent, useSetNavIntent } from "../shell/navIntents";
import { paymentCopy, usePaymentsCommands, type Shortfall } from "./paymentUi";
import { useWalletInventory } from "./useWalletInventory";

type ContactsMessaging = ReturnType<typeof useContactsMessagingComposition>;

interface UseCashuPaymentRequestsParams {
  autoPayLimit: number;
  chatMessages: readonly LocalNostrMessage[];
  contacts: readonly ContactRowLike[];
  currentNpub: string | null;
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  latestMessages: ContactsMessaging["latestMessages"];
  nostrMessagesLocal: readonly LocalNostrMessage[];
  nostrMessagesRecent: readonly LocalNostrMessage[];
  payAmount: string;
  rememberFirstPayment: () => void;
  reportShortfall: (shortfall: Shortfall) => void;
  route: ReturnType<typeof useRouting>;
  saveNpubContact: ContactsMessaging["saveNpubContact"];
  selectedChatContact: ContactsMessaging["selectedChatContact"];
  selectedContact: ContactRowLike | null;
  sendChatMessage: ContactsMessaging["sendChatMessage"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
  walletOpRunning: boolean;
}

const replyContextOf = (message: LocalNostrMessage): ReplyContext | null => {
  const replyToId = (message.rumorId ?? "").trim();
  if (!replyToId) return null;
  return {
    replyToId,
    rootMessageId: (message.rootMessageId ?? "").trim() || replyToId,
    replyToContent: message.content.trim() || null,
  };
};

const hostOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).hostname || null : null;
  } catch {
    return null;
  }
};

/**
 * NUT-18 cashu payment requests: paying one from a scan or a chat message
 * (the NUT-18 payload over its nostr or POST transport), and asking a
 * contact for one. A request is paid once at a time; another tap meanwhile
 * is dropped.
 */
export const useCashuPaymentRequests = ({
  autoPayLimit,
  chatMessages,
  contacts,
  currentNpub,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  logPaymentEvent,
  latestMessages,
  nostrMessagesLocal,
  nostrMessagesRecent,
  payAmount,
  rememberFirstPayment,
  reportShortfall,
  route,
  saveNpubContact,
  selectedChatContact,
  selectedContact,
  sendChatMessage,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
  walletOpRunning,
}: UseCashuPaymentRequestsParams) => {
  const commands = usePaymentsCommands();
  const runExclusively = useExclusiveRun();
  const contactsRef = useLatest(contacts);
  const openSavedContact = useSetNavIntent("openSavedContactNpub");
  const readContactPayBackToChat = useReadNavIntent("contactPayBackToChat");
  const touchMintInfo = useTouchMintInfo();
  const requestMints = useRequestMintUrls();
  const mintInfoByUrl = useMintInfoByUrl();
  const ownNprofile = useOwnNprofile(currentNpub);
  const allowTestMints = useAtomValue(allowTestMintsAtom);
  const defaultMint = useAtomValue(defaultMintAtom);
  const { balances } = useWalletInventory();

  const ensureContactFor = React.useCallback(
    (request: CashuPaymentRequestMessageInfo): ContactRowLike | null => {
      const requestPubkeyHex = normalizePubkeyHex(request.transportPubkeyHex);
      if (!requestPubkeyHex) return null;
      const existing = contacts.find(
        (contact) =>
          decodeNpub(normalizeNpubIdentifier(contact.npub ?? "") ?? "") ===
          requestPubkeyHex,
      );
      if (existing?.id) return existing;

      const pubkey = parsePubkey(requestPubkeyHex);
      if (!pubkey) return null;
      const saved = saveNpubContact(encodeNpub(pubkey));
      if (!saved) return null;
      if (saved.created) openSavedContact(saved.npub);
      return saved.contact;
    },
    [contacts, openSavedContact, saveNpubContact],
  );

  /** The incoming message that carried this request, to reply to. */
  const findRequestMessage = React.useCallback(
    (
      request: CashuPaymentRequestMessageInfo,
      contactId: string,
    ): LocalNostrMessage | null => {
      const { requestId } = request;
      const encodedRequest = request.encodedRequest.trim();
      if (!contactId.trim() || (!requestId && !encodedRequest)) return null;
      const candidates = [
        ...chatMessages,
        ...nostrMessagesRecent,
        ...nostrMessagesLocal,
      ];
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        if (message.contactId.trim() !== contactId.trim()) continue;
        if (message.direction.trim() !== "in") continue;
        if (!(message.rumorId ?? "").trim()) continue;
        const previous = parseCashuPaymentRequestMessage(message.content);
        if (!previous) continue;
        if (requestId && previous.requestId === requestId) return message;
        if (!requestId && previous.encodedRequest.trim() === encodedRequest)
          return message;
      }
      return null;
    },
    [chatMessages, nostrMessagesLocal, nostrMessagesRecent],
  );

  /** Whether a mint the wallet holds covers the request, so it need not go over Lightning. */
  const canPayCashuRequest = React.useCallback(
    (request: CashuPaymentRequestMessageInfo): boolean => {
      // Whether a held mint supports the lock is only known by asking it; an invoice leg needs no lock.
      if (request.lockTo !== null) return false;
      const plan = planPaymentRequestMint({
        amount: request.amount ?? 1,
        acceptedMints: request.mintUrls,
        allowTestMints,
        balances,
        defaultMint,
        userMints: requestMints,
        sendFee: (mint, amount) =>
          sendFeeAllowance(
            getMintFeePpk(mintInfoByUrl.get(normalizeMintUrl(mint))?.feesJson),
            amount,
          ),
      });
      return plan._tag === "Direct" || plan._tag === "NeedsMintMove";
    },
    [allowTestMints, balances, defaultMint, mintInfoByUrl, requestMints],
  );

  const quote = React.useCallback(
    async (request: CashuPaymentRequestMessageInfo, amountSat: number) => {
      if (commands !== null)
        return commands.quotePaymentRequest(request, amountSat);
      setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
      return null;
    },
    [commands, setStatus, t],
  );

  const reportUnpayable = React.useCallback(
    (outcome: UnpayableQuote) => {
      switch (outcome._tag) {
        case "Insufficient":
        case "NeedsMintMove":
          reportShortfall(outcome);
          return;
        case "LockingUnsupported":
          setStatus(t("paymentRequestLockUnsupported"));
          return;
        case "Failed":
          setStatus(`${t("payFailed")}: ${outcome.detail}`);
          return;
        case "NetworkError":
          setStatus(t("payNetworkError"));
          return;
      }
    },
    [reportShortfall, setStatus, t],
  );

  const pay = React.useCallback(
    async ({
      chat,
      quote: reviewedQuote,
      recipientDiffers,
      request,
    }: ReviewedCashuPaymentRequest) => {
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }
      if (reviewedQuote._tag === "Lightning" && reviewedQuote.addsMint)
        touchMintInfo(reviewedQuote.targetMint, nowSeconds());

      const recipient =
        request.preferredTransport !== "nostr"
          ? null
          : chat !== null && !recipientDiffers
            ? chat.contact
            : ensureContactFor(request);
      if (recipient === null && request.transportPostUrl === null) {
        setStatus(t("paymentRequestUnknownContact"));
        return;
      }
      const requestMessage =
        chat !== null && !recipientDiffers
          ? chat.message
          : recipient?.id
            ? findRequestMessage(request, recipient.id)
            : null;
      const overlayContact = paidOverlayContact(recipient);

      const outcome = await commands.payPaymentRequest(
        {
          request,
          quote: reviewedQuote,
          recipient,
          replyContext: requestMessage ? replyContextOf(requestMessage) : null,
          ...(chat
            ? {
                isPaymentAuthorized: () =>
                  isCurrentChatPaymentRequest(
                    chat.message,
                    request,
                    chat.contact,
                    latestMessages(),
                    contactsRef.current.find(
                      (contact) => contact.id === chat.contact.id,
                    ) ?? null,
                  ),
              }
            : {}),
        },
        {
          onSending: () =>
            showPaymentSending({
              direction: "out",
              amountSat: reviewedQuote.amount,
              contact: overlayContact,
            }),
        },
      );
      dismissPaymentSending();

      switch (outcome._tag) {
        case "Paid": {
          const name =
            (recipient?.name ?? "").trim() ||
            hostOf(request.transportPostUrl) ||
            request.description ||
            t("appTitle");
          showPaidOverlay(
            paymentCopy(
              outcome.queued ? t("paidQueuedTo") : t("paidSentTo"),
              formatDisplayedAmountParts(outcome.receipt.amount),
              name,
            ),
            {
              direction: "out",
              amountSat: outcome.receipt.amount,
              contact: overlayContact,
            },
          );
          rememberFirstPayment();
          if (outcome.contactId)
            navigateTo({ route: "chat", id: outcome.contactId });
          return;
        }
        case "Failed":
          setStatus(
            outcome.movedTo !== null
              ? paymentCopy(
                  t("paymentRequestMovedNotPaid"),
                  formatDisplayedAmountParts(
                    reviewedQuote._tag === "Lightning"
                      ? reviewedQuote.moveAmount
                      : reviewedQuote.amount,
                  ),
                  formatMintHost(outcome.movedTo),
                )
              : outcome.insufficient
                ? t("payInsufficient")
                : `${t("payFailed")}: ${outcome.detail}`,
          );
          return;
        case "NetworkError":
          setStatus(t("payNetworkError"));
          return;
        case "AuthorizationChanged":
          setStatus(t("payApprovalChanged"));
          return;
        case "MissingIdentity":
          setStatus(t("profileMissingNpub"));
          return;
        case "InvalidContact":
          setStatus(t("payFailed"));
          return;
        case "NoTransport":
          setStatus(t("paymentRequestNoTransport"));
          return;
        case "InsecureTransport":
          setStatus(t("paymentRequestInsecureTransport"));
          return;
        case "LockingUnsupported":
          setStatus(t("paymentRequestLockUnsupported"));
          return;
        case "Busy":
          return;
      }
    },
    [
      commands,
      contactsRef,
      dismissPaymentSending,
      ensureContactFor,
      findRequestMessage,
      formatDisplayedAmountParts,
      latestMessages,
      rememberFirstPayment,
      setStatus,
      showPaidOverlay,
      showPaymentSending,
      t,
      touchMintInfo,
    ],
  );

  const confirmation = useCashuPaymentRequestConfirmation({
    autoPayLimit,
    cashuIsBusy: walletOpRunning,
    pay,
    quote,
    reportUnpayable,
  });
  const { reviewCashuPaymentRequest } = confirmation;

  const startPayment = React.useCallback(
    (
      request: CashuPaymentRequestMessageInfo,
      chat: PendingCashuPaymentRequest["chat"],
      explicitTap: boolean,
    ) =>
      runExclusively(async () => {
        if (walletOpRunning) return;

        // A request addressed to our own key is already satisfied by the funds in
        // this wallet. Complete it locally as a success instead of gift-wrapping a
        // cashu token to ourselves over nostr, which the inbox treats as an
        // own-echo and never auto-claims — that is what stranded the token as an
        // unclaimable "awaiting claim" transfer.
        const ownPubkeyHex = normalizePubkeyHex(decodeNpub(currentNpub ?? ""));
        if (ownPubkeyHex && ownPubkeyHex === request.transportPubkeyHex) {
          showPaidOverlay(
            paymentCopy(
              t("paymentRequestSelfPayment"),
              formatDisplayedAmountParts(request.amount ?? 0),
            ),
          );
          return;
        }
        // Requests without a transport are issue #622.
        if (
          request.transportPubkeyHex === null &&
          request.transportPostUrl === null
        ) {
          setStatus(t("paymentRequestNoTransport"));
          return;
        }

        const recipientDiffers =
          chat !== null &&
          request.transportPubkeyHex !== null &&
          request.transportPubkeyHex !== decodeNpub(chat.contact.npub ?? "");
        await reviewCashuPaymentRequest({
          request,
          chat,
          recipientDiffers,
          explicitTap,
        });
      }),
    [
      currentNpub,
      formatDisplayedAmountParts,
      reviewCashuPaymentRequest,
      runExclusively,
      setStatus,
      showPaidOverlay,
      t,
      walletOpRunning,
    ],
  );

  /** A scanned or pasted request; held to the auto-pay limit. */
  const payCashuPaymentRequest = React.useCallback(
    (request: CashuPaymentRequestMessageInfo) =>
      startPayment(request, null, false),
    [startPayment],
  );

  const onPayChatPaymentRequest = React.useCallback(
    async (
      message: LocalNostrMessage,
      request: CashuPaymentRequestMessageInfo,
    ) => {
      if (!selectedChatContact || selectedChatContact.isUnknownContact) return;
      if (!selectedContact) return;
      const chat = { message: { ...message }, contact: { ...selectedContact } };
      if (
        !isCurrentChatPaymentRequest(
          chat.message,
          request,
          chat.contact,
          latestMessages(),
          contactsRef.current.find(
            (contact) => contact.id === chat.contact.id,
          ) ?? null,
        )
      ) {
        setStatus(t("paymentRequestChanged"));
        return;
      }
      await startPayment({ ...request }, chat, true);
    },
    [
      contactsRef,
      latestMessages,
      selectedChatContact,
      selectedContact,
      setStatus,
      startPayment,
      t,
    ],
  );

  const confirmCashuPaymentRequest = React.useCallback(
    () => runExclusively(confirmation.confirmCashuPaymentRequest),
    [confirmation.confirmCashuPaymentRequest, runExclusively],
  );
  const { enterCashuPaymentRequestAmount: enterAmount } = confirmation;
  const enterCashuPaymentRequestAmount = React.useCallback(
    (amountSat: number) => runExclusively(() => enterAmount(amountSat)),
    [enterAmount, runExclusively],
  );

  /** Sends the selected contact a payment request message for `payAmount`. */
  const requestSelectedContact = React.useCallback(
    async (options?: { note?: string | null }) => {
      if (route.kind !== "contactPay") return;
      if (!selectedContact) return;

      const note = (options?.note ?? "").trim() || null;
      const amountSat = Number.parseInt(payAmount.trim(), 10);
      if (!Number.isFinite(amountSat) || amountSat <= 0) {
        setStatus(t("payInvalidAmount"));
        return;
      }
      if (!normalizeNpubIdentifier(selectedContact.npub ?? "")) {
        setStatus(t("chatMissingContactNpub"));
        return;
      }
      if (!ownNprofile) {
        setStatus(t("profileMissingNpub"));
        return;
      }
      const recipientNprofile = ownNprofile;
      const requestId = PaymentRequestId.make(makeLocalId());
      const requestText = buildCashuPaymentRequestMessage({
        amount: amountSat,
        description: note,
        mintUrls: requestMints,
        recipientNprofile,
        requestId,
      });
      const outcome = await sendChatMessage({
        clearDraft: false,
        text: requestText,
      });
      if (outcome !== "enqueued") return;

      logPaymentEvent({
        amount: amountSat,
        contactId: route.id,
        details: {
          mintUrls: requestMints,
          recipientNprofile,
          requestId,
          requestText,
        },
        direction: "in",
        method: "cashu_chat",
        mint: requestMints[0] ?? null,
        note,
        status: "ok",
        transactionId: transactionIdForRequest(requestId),
        unit: "sat",
      });
      navigateTo(
        (readContactPayBackToChat() ?? "") === route.id
          ? { route: "chat", id: route.id }
          : { route: "contact", id: route.id },
      );
    },
    [
      logPaymentEvent,
      payAmount,
      ownNprofile,
      readContactPayBackToChat,
      requestMints,
      route,
      selectedContact,
      sendChatMessage,
      setStatus,
      t,
    ],
  );

  return {
    canPayCashuRequest,
    closeCashuPaymentRequestConfirmation:
      confirmation.closeCashuPaymentRequestConfirmation,
    confirmCashuPaymentRequest,
    enterCashuPaymentRequestAmount,
    onPayChatPaymentRequest,
    payCashuPaymentRequest,
    pendingCashuPaymentRequestConfirmation:
      confirmation.pendingCashuPaymentRequestConfirmation,
    requestSelectedContact,
  };
};
