import { reportAppLog } from "../../devtools/inspector/appLog";
import { decodeNpub, encodeNpub } from "@linky/linkstr";
import { useLatest } from "../../hooks/useLatest";
import React from "react";
import type {
  ContactIdentityRowLike,
  LocalPendingPayment,
  UpdateLocalNostrMessage,
} from "../types/appTypes";
import type { Translate } from "../../i18n";

interface PayResult {
  error?: string;
  ok: boolean;
  queued: boolean;
}

interface UsePaymentsDomainParams<TContact extends ContactIdentityRowLike> {
  cashuIsBusy: boolean;
  contacts: readonly TContact[];
  currentNpub: string | null;
  currentNsec: string | null;
  payContactWithCashuMessage: (args: {
    amountSat: number;
    contact: TContact;
    fromQueue?: boolean;
    isPaymentAuthorized?: () => boolean;
    pendingMessageId?: string;
  }) => Promise<PayResult>;
  pendingPayments: LocalPendingPayment[];
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  pushToast: (message: string) => void;
  removePendingPayment: (id: string) => void;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  t: Translate;
}

export const usePaymentsDomain = <TContact extends ContactIdentityRowLike>({
  cashuIsBusy,
  contacts,
  currentNpub,
  currentNsec,
  payContactWithCashuMessage,
  pendingPayments,
  updateLocalNostrMessage,
  pushToast,
  removePendingPayment,
  setCashuIsBusy,
  t,
}: UsePaymentsDomainParams<TContact>) => {
  const contactsLatestRef = useLatest(contacts);
  const pendingPaymentsFlushRef = React.useRef<Promise<void> | null>(null);

  const flushPendingPayments = React.useCallback(async () => {
    if (pendingPaymentsFlushRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!currentNsec || !currentNpub) return;
    if (cashuIsBusy) return;
    if (pendingPayments.length === 0) return;

    const run = Promise.resolve().then(async () => {
      try {
        for (const pending of pendingPayments) {
          const contact = contactsLatestRef.current.find(
            (candidate) => (candidate.id ?? "") === pending.contactId,
          );

          const approvedPubkey = pending.recipientPubkey;
          const isPaymentAuthorized = () =>
            Boolean(approvedPubkey) &&
            decodeNpub(
              contactsLatestRef.current.find(
                (candidate) => candidate.id === pending.contactId,
              )?.npub ?? "",
            ) === approvedPubkey;
          if (!contact || !approvedPubkey || !isPaymentAuthorized()) {
            reportAppLog({
              tag: "payment.queuedApprovalRejected",
              summary: "Queued payment requires new recipient approval",
              links: {
                payment: pending.id,
                ...(pending.messageId ? { message: pending.messageId } : {}),
              },
              payload: {
                reason: approvedPubkey
                  ? "recipient-changed"
                  : "legacy-unbound-recipient",
              },
            });
            removePendingPayment(pending.id);
            if (pending.messageId)
              updateLocalNostrMessage(pending.messageId, {
                content: t("payApprovalChanged"),
                status: "sent",
                localOnly: true,
              });
            pushToast(t("payApprovalChanged"));
            continue;
          }

          const amountSat = pending.amountSat || 0;
          if (amountSat <= 0) {
            removePendingPayment(pending.id);
            continue;
          }

          if (cashuIsBusy) break;

          setCashuIsBusy(true);
          try {
            const result = await payContactWithCashuMessage({
              contact: { ...contact, npub: encodeNpub(approvedPubkey) },
              amountSat,
              isPaymentAuthorized,
              fromQueue: true,
              ...(pending.messageId
                ? { pendingMessageId: pending.messageId }
                : {}),
            });

            if (result.ok) {
              removePendingPayment(pending.id);
            } else if (result.error) {
              pushToast(`${t("payFailed")}: ${result.error}`);
            }
          } catch {
            // Keep pending payment for retry.
          } finally {
            setCashuIsBusy(false);
          }
        }
      } finally {
        pendingPaymentsFlushRef.current = null;
      }
    });

    pendingPaymentsFlushRef.current = run;
    await run;
  }, [
    cashuIsBusy,
    contactsLatestRef,
    updateLocalNostrMessage,
    currentNpub,
    currentNsec,
    payContactWithCashuMessage,
    pendingPayments,
    pushToast,
    removePendingPayment,
    setCashuIsBusy,
    t,
  ]);

  React.useEffect(() => {
    const handleOnline = () => {
      void flushPendingPayments();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushPendingPayments]);

  React.useEffect(() => {
    void flushPendingPayments();
  }, [currentNsec, contacts, pendingPayments.length, flushPendingPayments]);
};
