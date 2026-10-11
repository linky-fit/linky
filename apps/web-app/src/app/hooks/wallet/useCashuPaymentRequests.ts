import { transactionIdForRequest } from "@linky-fit/linksync";
import {
  decodeNpub,
  encodeNpub,
  encodeNprofile,
  parsePubkey,
} from "@linky-fit/linkstr";
import React from "react";
import { useExclusiveRun } from "../../../hooks/useExclusiveRun";
import { useLatest } from "../../../hooks/useLatest";
import { navigateTo, type useRouting } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import type { ContactId } from "../../../evolu";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { recommendedNostrRelays } from "../../../utils/nostrRelays";
import { makeLocalId } from "../../../utils/validation";
import { isCurrentChatPaymentRequest } from "../../lib/chatPaymentRequestAuthorization";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "../../lib/paymentRequestMessage";
import type {
  ContactRowLike,
  LocalNostrMessage,
  LoggedPaymentEventParams,
} from "../../types/appTypes";
import type { useContactsMessagingComposition } from "../composition/useContactsMessagingComposition";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useCashuPaymentRequestConfirmation } from "../payments/useCashuPaymentRequestConfirmation";
import type { PayContactWithCashuMessage } from "./useContactPayments";
import { paymentCopy, usePaymentsCommands, type Shortfall } from "./paymentUi";

type ContactsMessaging = ReturnType<typeof useContactsMessagingComposition>;

interface UseCashuPaymentRequestsParams {
  autoPayLimit: number;
  chatMessages: readonly LocalNostrMessage[];
  contactPayBackToChatRef: React.RefObject<ContactId | null>;
  contacts: readonly ContactRowLike[];
  currentNpub: string | null;
  defaultMintUrl: string | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  latestMessages: ContactsMessaging["latestMessages"];
  nostrMessagesLocal: readonly LocalNostrMessage[];
  nostrMessagesRecent: readonly LocalNostrMessage[];
  openScannedContactPendingNpubRef: ContactsMessaging["openScannedContactPendingNpubRef"];
  payAmount: string;
  payContactWithCashuMessage: PayContactWithCashuMessage;
  rememberFirstPayment: () => void;
  reportShortfall: (shortfall: Shortfall) => void;
  route: ReturnType<typeof useRouting>;
  saveNpubContact: ContactsMessaging["saveNpubContact"];
  selectedChatContact: ContactsMessaging["selectedChatContact"];
  selectedContact: ContactRowLike | null;
  sendChatMessage: ContactsMessaging["sendChatMessage"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  t: Translate;
  walletOpRunning: boolean;
}

/**
 * NUT-18 cashu payment requests: paying one from a scan or a chat message
 * (to its contact over Nostr, or by POST), and asking a contact for one.
 * A request is paid once at a time; another tap meanwhile is dropped.
 */
export const useCashuPaymentRequests = ({
  autoPayLimit,
  chatMessages,
  contactPayBackToChatRef,
  contacts,
  currentNpub,
  defaultMintUrl,
  formatDisplayedAmountParts,
  logPaymentEvent,
  latestMessages,
  nostrMessagesLocal,
  nostrMessagesRecent,
  openScannedContactPendingNpubRef,
  payAmount,
  payContactWithCashuMessage,
  rememberFirstPayment,
  reportShortfall,
  route,
  saveNpubContact,
  selectedChatContact,
  selectedContact,
  sendChatMessage,
  setStatus,
  showPaidOverlay,
  t,
  walletOpRunning,
}: UseCashuPaymentRequestsParams) => {
  const commands = usePaymentsCommands();
  const runExclusively = useExclusiveRun();
  const contactsRef = useLatest(contacts);

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
      if (saved.created) openScannedContactPendingNpubRef.current = saved.npub;
      return saved.contact;
    },
    [contacts, openScannedContactPendingNpubRef, saveNpubContact],
  );

  /** The incoming message that carried this request, to reply to. */
  const findRequestMessage = React.useCallback(
    (
      request: CashuPaymentRequestMessageInfo,
      contactId: string,
    ): LocalNostrMessage | null => {
      const requestId = (request.requestId ?? "").trim();
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
        if (requestId && (previous.requestId ?? "").trim() === requestId)
          return message;
        if (!requestId && previous.encodedRequest.trim() === encodedRequest)
          return message;
      }
      return null;
    },
    [chatMessages, nostrMessagesLocal, nostrMessagesRecent],
  );

  /** True once the request is handled here, paid or not. */
  const payByPost = React.useCallback(
    async (request: CashuPaymentRequestMessageInfo): Promise<boolean> => {
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return true;
      }
      const outcome = await commands.payCashuPaymentRequestByPost(request);
      switch (outcome._tag) {
        case "NoPostTransport":
          return false;
        case "InvalidUrl":
          setStatus(t("paymentRequestUnknownContact"));
          return false;
        case "InsecureTransport":
          setStatus(t("paymentRequestInsecureTransport"));
          return false;
        case "Insufficient":
          setStatus(t("payInsufficient"));
          return true;
        case "Paid":
          showPaidOverlay(
            paymentCopy(
              t("paidSentTo"),
              formatDisplayedAmountParts(outcome.receipt.amount),
              request.description || outcome.postUrl.hostname || t("appTitle"),
            ),
            { direction: "out", amountSat: outcome.receipt.amount },
          );
          rememberFirstPayment();
          return true;
        case "Failed":
          setStatus(
            outcome.insufficient
              ? t("payInsufficient")
              : `${t("payFailed")}: ${outcome.detail}`,
          );
          return true;
        case "Busy":
          return true;
      }
    },
    [
      commands,
      formatDisplayedAmountParts,
      rememberFirstPayment,
      setStatus,
      showPaidOverlay,
      t,
    ],
  );

  const runCashuPaymentRequest = React.useCallback(
    (request: CashuPaymentRequestMessageInfo) =>
      runExclusively(async () => {
        if (walletOpRunning) return;

        // A request addressed to our own key is already satisfied by the funds in
        // this wallet. Complete it locally as a success instead of gift-wrapping a
        // cashu token to ourselves over nostr, which the inbox treats as an
        // own-echo and never auto-claims — that is what stranded the token as an
        // unclaimable "awaiting claim" transfer.
        const ownPubkeyHex = normalizePubkeyHex(decodeNpub(currentNpub ?? ""));
        const targetPubkeyHex = normalizePubkeyHex(request.transportPubkeyHex);
        if (ownPubkeyHex && ownPubkeyHex === targetPubkeyHex) {
          showPaidOverlay(
            paymentCopy(
              t("paymentRequestSelfPayment"),
              formatDisplayedAmountParts(request.amount),
            ),
          );
          return;
        }

        if (commands !== null) {
          const funds = await commands.fundsFor(request.amount, {
            acceptedMints: request.mintUrls,
          });
          if (funds._tag !== "Covered") {
            reportShortfall(funds);
            return;
          }
        }

        const contact = ensureContactFor(request);
        const contactId = contact?.id;
        if (!contact || !contactId) {
          if (await payByPost(request)) return;
          setStatus(t("paymentRequestUnknownContact"));
          return;
        }

        const previous = findRequestMessage(request, contactId);
        const previousRumorId = (previous?.rumorId ?? "").trim();
        await payContactWithCashuMessage({
          contact,
          amountSat: request.amount,
          memo: request.description,
          paymentRequestId: request.requestId,
          ...(previousRumorId
            ? {
                replyContext: {
                  replyToId: previousRumorId,
                  rootMessageId:
                    (previous?.rootMessageId ?? "").trim() || previousRumorId,
                  replyToContent: (previous?.content ?? "").trim() || null,
                },
              }
            : {}),
        });
      }),
    [
      commands,
      currentNpub,
      ensureContactFor,
      findRequestMessage,
      formatDisplayedAmountParts,
      payByPost,
      payContactWithCashuMessage,
      reportShortfall,
      runExclusively,
      setStatus,
      showPaidOverlay,
      t,
      walletOpRunning,
    ],
  );

  const onPayChatPaymentRequest = React.useCallback(
    (message: LocalNostrMessage, request: CashuPaymentRequestMessageInfo) =>
      runExclusively(async () => {
        if (walletOpRunning) return;
        if (!selectedChatContact || selectedChatContact.isUnknownContact)
          return;
        if (!selectedContact) return;

        const reviewedMessage = { ...message };
        const reviewedRequest = { ...request };
        const reviewedRecipient = { ...selectedContact };
        const isPaymentAuthorized = () =>
          isCurrentChatPaymentRequest(
            reviewedMessage,
            reviewedRequest,
            reviewedRecipient,
            latestMessages(),
            contactsRef.current.find(
              (contact) => contact.id === reviewedRecipient.id,
            ) ?? null,
          );
        if (!isPaymentAuthorized()) {
          setStatus(t("paymentRequestChanged"));
          return;
        }
        const requestRumorId = (reviewedMessage.rumorId ?? "").trim();
        await payContactWithCashuMessage({
          contact: reviewedRecipient,
          amountSat: reviewedRequest.amount,
          memo: reviewedRequest.description,
          paymentRequestId: reviewedRequest.requestId,
          isPaymentAuthorized,
          replyContext: {
            replyToId: requestRumorId,
            rootMessageId:
              (reviewedMessage.rootMessageId ?? "").trim() || requestRumorId,
            replyToContent: reviewedMessage.content.trim() || null,
          },
        });
      }),
    [
      contactsRef,
      latestMessages,
      payContactWithCashuMessage,
      runExclusively,
      selectedChatContact,
      selectedContact,
      setStatus,
      t,
      walletOpRunning,
    ],
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
      const recipientPubkeyHex = decodeNpub(currentNpub ?? "");
      if (!recipientPubkeyHex) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      const recipientNprofile = encodeNprofile(
        recipientPubkeyHex,
        recommendedNostrRelays(),
      );
      const preferredMint =
        normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;
      const requestId = makeLocalId();
      const requestText = buildCashuPaymentRequestMessage({
        amount: amountSat,
        description: note,
        mintUrls: [preferredMint],
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
          mintUrls: [preferredMint],
          recipientNprofile,
          requestId,
          requestText,
        },
        direction: "in",
        method: "cashu_chat",
        mint: preferredMint,
        note,
        status: "ok",
        transactionId: transactionIdForRequest(requestId),
        unit: "sat",
      });
      navigateTo(
        (contactPayBackToChatRef.current ?? "") === route.id
          ? { route: "chat", id: route.id }
          : { route: "contact", id: route.id },
      );
    },
    [
      contactPayBackToChatRef,
      currentNpub,
      defaultMintUrl,
      logPaymentEvent,
      payAmount,
      route,
      selectedContact,
      sendChatMessage,
      setStatus,
      t,
    ],
  );

  const confirmation = useCashuPaymentRequestConfirmation({
    cashuIsBusy: walletOpRunning,
    currentNpub,
    autoPayLimit,
    runCashuPaymentRequest,
  });

  return { ...confirmation, onPayChatPaymentRequest, requestSelectedContact };
};
