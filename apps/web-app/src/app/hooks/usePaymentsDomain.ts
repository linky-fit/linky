import { reportAppLog } from "../../devtools/inspector/appLog";
import { decodeNpub, encodeNpub } from "@linky-fit/linkstr";
import { useLatest } from "../../hooks/useLatest";
import { Option } from "effect";
import React from "react";
import type { RunExclusiveTask } from "../state/wallet/opQueue";
import type {
  ContactIdentityRowLike,
  LocalPendingPayment,
  UpdateLocalNostrMessage,
} from "../types/appTypes";
import type { Translate } from "../../i18n";
import { getUnknownErrorMessage } from "../../utils/unknown";
import {
  appendStoredPendingPayment,
  claimStoredPendingPayment,
  readPendingPayments,
  withPendingPaymentsFlushLock,
} from "../lib/pendingPayments";
import type { CashuMessagePaymentHookResult } from "./payments/cashuMessagePaymentTypes";

interface UsePaymentsDomainParams<TContact extends ContactIdentityRowLike> {
  cashuBalance: number;
  cashuIsBusy: boolean;
  cashuReady: boolean;
  contacts: readonly TContact[];
  currentNpub: string | null;
  currentNsec: string | null;
  payContactWithCashuMessage: (args: {
    amountSat: number;
    contact: TContact;
    fromQueue?: boolean;
    isPaymentAuthorized?: () => boolean;
    pendingMessageId?: string;
  }) => Promise<CashuMessagePaymentHookResult>;
  pendingPaymentsKey: string | null;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  pushToast: (message: string) => void;
  runExclusive: RunExclusiveTask;
  t: Translate;
}

const WALLET_BUSY: CashuMessagePaymentHookResult = {
  error: "wallet busy",
  ok: false,
  queued: false,
  retryable: true,
};

const paymentLinks = (pending: LocalPendingPayment) => ({
  payment: pending.id,
  ...(pending.messageId ? { message: pending.messageId } : {}),
});

/**
 * Each queued payment is claimed (removed from storage) under a cross-tab
 * lock before it is sent: a crash after the claim loses the queue entry but
 * never sends it twice.
 */
export const usePaymentsDomain = <TContact extends ContactIdentityRowLike>({
  cashuBalance,
  cashuIsBusy,
  cashuReady,
  contacts,
  currentNpub,
  currentNsec,
  payContactWithCashuMessage,
  pendingPaymentsKey,
  updateLocalNostrMessage,
  pushToast,
  runExclusive,
  t,
}: UsePaymentsDomainParams<TContact>) => {
  const contactsLatestRef = useLatest(contacts);
  const pendingPaymentsFlushRef = React.useRef<Promise<void> | null>(null);

  const cancelPendingPayment = React.useCallback(
    (pending: LocalPendingPayment, notice: string) => {
      if (pending.messageId)
        updateLocalNostrMessage(pending.messageId, {
          content: notice,
          status: "sent",
          localOnly: true,
        });
      pushToast(notice);
    },
    [pushToast, updateLocalNostrMessage],
  );

  const sendClaimedPayment = React.useCallback(
    async (key: string, pending: LocalPendingPayment) => {
      const approvedPubkey = pending.recipientPubkey;
      const findContact = () =>
        contactsLatestRef.current.find(
          (candidate) => candidate.id === pending.contactId,
        );
      const isPaymentAuthorized = () =>
        Boolean(approvedPubkey) &&
        decodeNpub(findContact()?.npub ?? "") === approvedPubkey;
      const contact = findContact();
      if (!contact || !approvedPubkey || !isPaymentAuthorized()) {
        reportAppLog({
          tag: "payment.queuedApprovalRejected",
          summary: "Queued payment requires new recipient approval",
          links: paymentLinks(pending),
          payload: {
            reason: approvedPubkey
              ? "recipient-changed"
              : "legacy-unbound-recipient",
          },
        });
        cancelPendingPayment(pending, t("payApprovalChanged"));
        return;
      }

      let result: CashuMessagePaymentHookResult;
      try {
        const paid = await runExclusive(() =>
          payContactWithCashuMessage({
            contact: { ...contact, npub: encodeNpub(approvedPubkey) },
            amountSat: pending.amountSat,
            isPaymentAuthorized,
            fromQueue: true,
            ...(pending.messageId
              ? { pendingMessageId: pending.messageId }
              : {}),
          }),
        );
        // Claimed from storage already; another wallet operation won the
        // queue, so it goes back for the next flush.
        result = Option.getOrElse(paid, () => WALLET_BUSY);
      } catch (error) {
        result = {
          error: getUnknownErrorMessage(error, "unknown"),
          ok: false,
          queued: false,
        };
      }

      if (result.ok) return;
      if (result.retryable) {
        appendStoredPendingPayment(key, pending);
        return;
      }
      const error = result.error ?? "unknown";
      reportAppLog({
        tag: "payment.queuedFailed",
        summary: `Queued payment failed and was dropped: ${error}`,
        links: paymentLinks(pending),
        payload: { amountSat: pending.amountSat, error },
      });
      cancelPendingPayment(pending, `${t("payFailed")}: ${error}`);
    },
    [
      cancelPendingPayment,
      contactsLatestRef,
      payContactWithCashuMessage,
      runExclusive,
      t,
    ],
  );

  const flushPendingPayments = React.useCallback(async () => {
    if (pendingPaymentsFlushRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!currentNsec || !currentNpub) return;
    if (cashuIsBusy || !cashuReady || !pendingPaymentsKey) return;
    const key = pendingPaymentsKey;

    const run = Promise.resolve()
      .then(() =>
        withPendingPaymentsFlushLock(async () => {
          for (const { id } of readPendingPayments(key)) {
            const pending = claimStoredPendingPayment(key, id);
            if (pending) await sendClaimedPayment(key, pending);
          }
        }),
      )
      .finally(() => {
        pendingPaymentsFlushRef.current = null;
      });

    pendingPaymentsFlushRef.current = run;
    await run;
  }, [
    cashuIsBusy,
    cashuReady,
    currentNpub,
    currentNsec,
    pendingPaymentsKey,
    sendClaimedPayment,
  ]);
  const flushLatestRef = useLatest(flushPendingPayments);

  React.useEffect(() => {
    const handleOnline = () => {
      void flushLatestRef.current();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushLatestRef]);

  // Not keyed on busy state or the pay callback: every attempt changes them,
  // which would retry a payment waiting for funds in a loop.
  React.useEffect(() => {
    void flushLatestRef.current();
  }, [
    cashuBalance,
    cashuReady,
    contacts,
    currentNsec,
    flushLatestRef,
    pendingPaymentsKey,
  ]);
};
