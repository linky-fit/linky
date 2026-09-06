import React from "react";
import type {
  ContactIdentityRowLike,
  LocalPendingPayment,
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
    pendingMessageId?: string;
  }) => Promise<PayResult>;
  pendingPayments: LocalPendingPayment[];
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
  pushToast,
  removePendingPayment,
  setCashuIsBusy,
  t,
}: UsePaymentsDomainParams<TContact>) => {
  const pendingPaymentsFlushRef = React.useRef<Promise<void> | null>(null);

  const flushPendingPayments = React.useCallback(async () => {
    if (pendingPaymentsFlushRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!currentNsec || !currentNpub) return;
    if (cashuIsBusy) return;
    if (pendingPayments.length === 0) return;

    const run = (async () => {
      try {
        for (const pending of pendingPayments) {
          const contact = contacts.find(
            (candidate) => (candidate.id ?? "") === pending.contactId,
          );

          if (!contact) {
            removePendingPayment(pending.id);
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
              contact,
              amountSat,
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
    })();

    pendingPaymentsFlushRef.current = run;
    await run;
  }, [
    cashuIsBusy,
    contacts,
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
