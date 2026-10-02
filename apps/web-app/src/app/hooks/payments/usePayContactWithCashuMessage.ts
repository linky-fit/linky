import { transactionIdForOperation } from "@linky-fit/linksync";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import {
  decodeNpub,
  type Pubkey,
  type PaymentNoticeContext,
} from "@linky-fit/linkstr";
import type { SendError, SendReceipt } from "@linky-fit/linkshu";
import {
  enqueueOutboxAtom,
  sendPaymentNoticeAtom,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import { Either } from "effect";
import React from "react";
import { ContactId } from "@linky-fit/linksync";
import { navigateTo } from "../../../hooks/useRouting";
import { CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY } from "../../../utils/constants";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { normalizeMintUrl } from "../../../utils/mint";
import { safeLocalStorageSet } from "../../../utils/storage";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import { reportCashuSendForgotten } from "../../lib/cashuSendInspector";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import { selectSendMintForAmount } from "../../lib/paymentMintSelection";
import type { SendMintBalance } from "../../lib/paymentMintSelection";
import type {
  AppendLocalNostrMessage,
  ContactRowLike,
  LocalNostrMessage,
  LoggedPaymentEventParams,
  PaymentLogData,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import type {
  CashuTransferLifecycle,
  SendCashuToken,
} from "../composition/useLinkshuComposition";
import type { ReplyContext } from "../messages/useSendChatMessage";
import type { CashuMessagePaymentHookResult } from "./cashuMessagePaymentTypes";
import { publishCashuMessagePayment } from "./publishCashuMessagePayment";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";

interface UsePayContactWithCashuMessageParams {
  appendLocalNostrMessage: AppendLocalNostrMessage;
  cashuBalance: number;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  cashuTransferLifecycle: CashuTransferLifecycle | null;
  currentNpub: string | null;
  currentNsec: string | null;
  defaultMintUrl: string | null;
  dismissPaymentSending: () => void;
  enqueuePendingPayment: (payload: {
    amountSat: number;
    contactId: ContactId;
    recipientPubkey: Pubkey;
    messageId?: string;
  }) => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  nostrMessagesLocal: LocalNostrMessage[];
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  sendCashuToken: SendCashuToken | null;
  setContactsOnboardingHasPaid: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  /** Per-mint spendable balances from the linkshu read model. */
  walletMintBalances: readonly SendMintBalance[];
}

const describeSendError = (error: SendError): string =>
  describeTaggedCashuError(error) ?? error._tag;

/**
 * Contact payment over messages: linkshu Send produces the token as a
 * `pending` row (funds stay in the store while the message is in flight),
 * the token text travels as a chat message, and the row is forgotten once
 * the publish is confirmed. Unconfirmed publishes leave the row `pending`
 * for the outbox retry / the pending-row cleanup effect / manual
 * return-to-wallet.
 */
export const usePayContactWithCashuMessage = <TContact extends ContactRowLike>({
  appendLocalNostrMessage,
  cashuBalance,
  cashuTransferLifecycle,
  currentNpub,
  currentNsec,
  defaultMintUrl,
  dismissPaymentSending,
  enqueuePendingPayment,
  formatDisplayedAmountParts,
  logPayStep,
  logPaymentEvent,
  nostrMessagesLocal,
  payWithCashuEnabled,
  pushToast,
  sendCashuToken,
  setContactsOnboardingHasPaid,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
  updateLocalNostrMessage,
  walletMintBalances,
}: UsePayContactWithCashuMessageParams) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, {
    mode: "promiseExit",
  });
  const sendPaymentNotice = useAtomSet(sendPaymentNoticeAtom, {
    mode: "promiseExit",
  });

  return React.useCallback(
    async (args: {
      amountSat: number;
      contact: TContact;
      fromQueue?: boolean;
      logCompletedOnly?: boolean;
      /** Travels as the token's memo and is kept as the transaction note. */
      memo?: string | null;
      paymentNoticeContext?: PaymentNoticeContext;
      paymentNoticeOfferId?: string;
      paymentRequestId?: string | null;
      isPaymentAuthorized?: () => boolean;
      pendingMessageId?: string;
      replyContext?: ReplyContext | null;
    }): Promise<CashuMessagePaymentHookResult> => {
      const {
        amountSat,
        contact,
        fromQueue,
        logCompletedOnly = false,
        memo,
        paymentNoticeContext,
        paymentNoticeOfferId,
        paymentRequestId,
        isPaymentAuthorized,
        pendingMessageId,
        replyContext,
      } = args;
      const notify = !fromQueue;
      const note = (memo ?? "").trim() || null;
      if (isPaymentAuthorized && !isPaymentAuthorized()) {
        setStatus(t("payApprovalChanged"));
        return {
          error: "payment authorization changed",
          ok: false,
          queued: false,
        };
      }
      const normalizedPendingMessageId =
        typeof pendingMessageId === "string" && pendingMessageId.trim()
          ? pendingMessageId.trim()
          : null;

      if (!currentNsec || !currentNpub) {
        if (notify) setStatus(t("profileMissingNpub"));
        return {
          error: "missing nsec",
          ok: false,
          queued: false,
          retryable: true,
        };
      }

      const contactNpub = (contact.npub ?? "").trim();
      const recipientPubkey = decodeNpub(contactNpub);
      if (!recipientPubkey) {
        if (notify) setStatus(t("chatMissingContactNpub"));
        return { error: "missing contact npub", ok: false, queued: false };
      }

      const parsedContactId = ContactId.fromUnknown(contact.id);
      if (!parsedContactId.ok) {
        if (notify) setStatus(t("payFailed"));
        return { error: "invalid contact id", ok: false, queued: false };
      }
      const contactId = parsedContactId.value;

      logPayStep("start", {
        amountSat,
        cashuBalance,
        contactId: contactId,
        fromQueue: Boolean(fromQueue),
        payWithCashuEnabled,
      });

      const isOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (isOffline) {
        const displayName =
          (contact.name ?? "").trim() ||
          (contact.lnAddress ?? "").trim() ||
          t("appTitle");
        const displayAmount = formatDisplayedAmountParts(amountSat);
        const clientId = makeLocalId();
        const appended = appendLocalNostrMessage({
          clientId,
          contactId: contactId,
          content: t("payQueuedMessage")
            .replace(
              "{amount}",
              `${displayAmount.approxPrefix}${displayAmount.amountText}`,
            )
            .replace("{unit}", displayAmount.unitLabel)
            .replace("{name}", displayName),
          createdAtSec: nowSeconds(),
          direction: "out",
          localOnly: true,
          pubkey: "",
          rumorId: null,
          status: "pending",
          wrapId: `pending:pay:${clientId}`,
        });
        const written = await appended.written;
        if (!appended.id || !written.ok) {
          const error = written.ok
            ? "failed to persist message"
            : written.error;
          if (notify) setStatus(`${t("payFailed")}: ${error}`);
          return { error, ok: false, queued: false, retryable: true };
        }
        const messageId = appended.id;
        logPayStep("queued-offline", {
          amountSat,
          contactId: contactId,
          messageId,
        });
        enqueuePendingPayment({
          amountSat,
          contactId,
          recipientPubkey,
          messageId,
        });
        if (notify) {
          showPaidOverlay(
            t("paidQueuedTo")
              .replace(
                "{amount}",
                `${displayAmount.approxPrefix}${displayAmount.amountText}`,
              )
              .replace("{unit}", displayAmount.unitLabel)
              .replace("{name}", displayName),
            {
              direction: "out",
              amountSat,
              contact: paidOverlayContact(contact),
            },
          );
          safeLocalStorageSet(CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY, "1");
          setContactsOnboardingHasPaid(true);
          navigateTo({ id: contactId, route: "chat" });
        }
        return { ok: true, queued: true };
      }

      if (sendCashuToken === null || cashuTransferLifecycle === null) {
        if (notify)
          setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return {
          error: "cashu storage not ready",
          ok: false,
          queued: false,
          retryable: true,
        };
      }

      const mint = selectSendMintForAmount(
        walletMintBalances,
        normalizeMintUrl(defaultMintUrl ?? ""),
        amountSat,
      );
      if (mint === null) {
        if (notify) setStatus(t("payInsufficient"));
        return {
          error: "insufficient",
          ok: false,
          queued: false,
          retryable: true,
        };
      }
      logPayStep("mint-selected", { amountSat, mint });
      if (notify) {
        showPaymentSending({
          direction: "out",
          amountSat,
          contact: paidOverlayContact(contact),
        });
      }

      try {
        const logFailure = (
          error: string,
          mintUrl: string | null,
          phase: "publish" | "swap",
        ): void => {
          if (logCompletedOnly) return;
          logPaymentEvent({
            amount: amountSat,
            contactId,
            direction: "out",
            error,
            fee: null,
            method: "cashu_chat",
            mint: mintUrl,
            phase,
            status: "error",
            unit: "sat",
          });
        };

        let sendOutcome: Either.Either<SendReceipt, SendError>;
        try {
          sendOutcome = await sendCashuToken({
            amountSat,
            memo: note,
            mint,
            produceAs: "pending",
          });
        } catch (error) {
          const message = getUnknownErrorMessage(error, "unknown");
          logFailure(message, mint, "swap");
          if (notify) setStatus(`${t("payFailed")}: ${message}`);
          return { error: message, ok: false, queued: false };
        }

        if (Either.isLeft(sendOutcome)) {
          const sendError = sendOutcome.left;
          const message = describeSendError(sendError);
          logFailure(message, mint, "swap");
          if (notify) {
            setStatus(
              sendError._tag === "InsufficientFunds"
                ? t("payInsufficient")
                : `${t("payFailed")}: ${message}`,
            );
          }
          return { error: message, ok: false, queued: false };
        }

        const receipt = sendOutcome.right;
        if (isPaymentAuthorized && !isPaymentAuthorized()) {
          reportAppLog({
            tag: "paymentRequest.authorizationLost",
            summary:
              "Payment authorization changed before token delivery; returning funds",
            links: { operation: receipt.operationId },
            payload: null,
          });
          try {
            const restored = await cashuTransferLifecycle.returnToWallet(
              receipt.operationId,
            );
            if (Either.isLeft(restored))
              logFailure(restored.left._tag, receipt.mint, "swap");
          } catch (error) {
            logFailure(
              getUnknownErrorMessage(error, "return-to-wallet failed"),
              receipt.mint,
              "swap",
            );
          }
          setStatus(t("payApprovalChanged"));
          return {
            error: "payment authorization changed",
            ok: false,
            queued: false,
          };
        }
        logPayStep("swap-ok", {
          changeAmount: receipt.changeAmount,
          feePaid: receipt.feePaid,
          mint: receipt.mint,
          sendAmount: receipt.amount,
        });

        let publishing;
        try {
          publishing = await publishCashuMessagePayment({
            appendLocalNostrMessage,
            batches: [
              {
                amount: receipt.amount,
                mint: receipt.mint,
                token: receipt.tokenText,
                unit: receipt.unit,
              },
            ],
            contactId,
            contactNpub,
            currentNpub,
            enqueueOutbox,
            logPayStep,
            nostrMessagesLocal,
            ...(paymentNoticeContext ? { paymentNoticeContext } : {}),
            ...(paymentNoticeOfferId ? { paymentNoticeOfferId } : {}),
            pendingMessageId: normalizedPendingMessageId,
            ...(replyContext ? { replyContext } : {}),
            sendPaymentNotice,
            updateLocalNostrMessage,
          });
        } catch (error) {
          // The send row stays `pending`: the outbox may still deliver the
          // message, and the pending-row cleanup effect / return-to-wallet
          // cover both outcomes.
          const message = getUnknownErrorMessage(error, "unknown");
          logFailure(message, receipt.mint, "publish");
          if (notify) setStatus(`${t("payFailed")}: ${message}`);
          return { error: message, ok: false, queued: false };
        }

        for (const publishError of publishing.publishErrors) {
          if (notify) {
            pushToast(`${t("payFailed")}: ${publishError.error}`);
          }
        }

        if (!publishing.hasPendingMessages) {
          // The message carrying the token is published; the funds are the
          // contact's now, so the pending row has nothing left to guard.
          await cashuTransferLifecycle.forget(receipt.operationId);
          reportCashuSendForgotten({
            mint: receipt.mint,
            reason: "message-published",
            operationId: receipt.operationId,
          });
        }

        if (!logCompletedOnly || !publishing.hasPendingMessages) {
          logPaymentEvent({
            amount: receipt.amount,
            contactId,
            details: {
              issuedToken: receipt.tokenText,
              ...(paymentRequestId ? { requestId: paymentRequestId } : {}),
            },
            direction: "out",
            error: null,
            fee: null,
            method: "cashu_chat",
            mint: receipt.mint,
            note,
            phase: publishing.hasPendingMessages ? "publish" : "complete",
            status: "ok",
            transactionId: transactionIdForOperation(receipt.operationId),
            unit: "sat",
          });
        }

        if (notify) {
          const displayName =
            (contact.name ?? "").trim() ||
            (contact.lnAddress ?? "").trim() ||
            t("appTitle");
          const displayAmount = formatDisplayedAmountParts(receipt.amount);
          showPaidOverlay(
            (publishing.hasPendingMessages
              ? t("paidQueuedTo")
              : t("paidSentTo")
            )
              .replace(
                "{amount}",
                `${displayAmount.approxPrefix}${displayAmount.amountText}`,
              )
              .replace("{unit}", displayAmount.unitLabel)
              .replace("{name}", displayName),
            {
              direction: "out",
              amountSat: receipt.amount,
              contact: paidOverlayContact(contact),
            },
          );
          safeLocalStorageSet(CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY, "1");
          setContactsOnboardingHasPaid(true);
          navigateTo({ id: contactId, route: "chat" });
        }

        return { ok: true, queued: publishing.hasPendingMessages };
      } finally {
        if (notify) dismissPaymentSending();
      }
    },
    [
      appendLocalNostrMessage,
      cashuBalance,
      cashuTransferLifecycle,
      currentNpub,
      currentNsec,
      defaultMintUrl,
      dismissPaymentSending,
      enqueueOutbox,
      enqueuePendingPayment,
      formatDisplayedAmountParts,
      logPayStep,
      logPaymentEvent,
      nostrMessagesLocal,
      payWithCashuEnabled,
      pushToast,
      sendCashuToken,
      sendPaymentNotice,
      setContactsOnboardingHasPaid,
      setStatus,
      showPaidOverlay,
      showPaymentSending,
      t,
      updateLocalNostrMessage,
      walletMintBalances,
    ],
  );
};
