import { decodeNpub } from "@linky-fit/linkstr";
import { useCallback, useState } from "react";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { normalizePubkeyHex } from "../messages/contactIdentity";

interface UseCashuPaymentRequestConfirmationParams {
  cashuIsBusy: boolean;
  currentNpub: string | null;
  autoPayLimit: number;
  runCashuPaymentRequest: (
    requestInfo: CashuPaymentRequestMessageInfo,
  ) => Promise<void>;
}

export const useCashuPaymentRequestConfirmation = ({
  cashuIsBusy,
  currentNpub,
  autoPayLimit,
  runCashuPaymentRequest,
}: UseCashuPaymentRequestConfirmationParams) => {
  const [
    pendingCashuPaymentRequestConfirmation,
    setPendingCashuPaymentRequestConfirmation,
  ] = useState<CashuPaymentRequestMessageInfo | null>(null);

  const payCashuPaymentRequest = useCallback(
    async (requestInfo: CashuPaymentRequestMessageInfo) => {
      if (cashuIsBusy) return;

      const ownPubkeyHex = normalizePubkeyHex(decodeNpub(currentNpub ?? ""));
      const targetPubkeyHex = normalizePubkeyHex(
        requestInfo.transportPubkeyHex,
      );
      const isSelfPayment =
        ownPubkeyHex && targetPubkeyHex && ownPubkeyHex === targetPubkeyHex;
      if (isSelfPayment || requestInfo.amount <= autoPayLimit) {
        await runCashuPaymentRequest(requestInfo);
        return;
      }

      setPendingCashuPaymentRequestConfirmation(requestInfo);
    },
    [cashuIsBusy, currentNpub, autoPayLimit, runCashuPaymentRequest],
  );

  const closeCashuPaymentRequestConfirmation = useCallback(() => {
    if (cashuIsBusy) return;
    setPendingCashuPaymentRequestConfirmation(null);
  }, [cashuIsBusy]);

  const confirmCashuPaymentRequest = useCallback(async () => {
    const pending = pendingCashuPaymentRequestConfirmation;
    if (!pending || cashuIsBusy) return;
    setPendingCashuPaymentRequestConfirmation(null);
    await runCashuPaymentRequest(pending);
  }, [
    cashuIsBusy,
    pendingCashuPaymentRequestConfirmation,
    runCashuPaymentRequest,
  ]);

  return {
    closeCashuPaymentRequestConfirmation,
    confirmCashuPaymentRequest,
    payCashuPaymentRequest,
    pendingCashuPaymentRequestConfirmation,
  };
};
