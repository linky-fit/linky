import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { walletCommandsAtom } from "../../state/wallet/walletCommands";
import type { LocalNostrMessage } from "../../types/appTypes";

/** The wallet composition's payments, token recovery and payment confirmations. */
export const useWalletCommands = () => {
  const commands = useAtomValue(walletCommandsAtom);
  return React.useMemo(
    () => ({
      closeCashuPaymentRequestConfirmation: () =>
        commands?.read().closeCashuPaymentRequestConfirmation(),
      closeLightningInvoiceConfirmation: () =>
        commands?.read().closeLightningInvoiceConfirmation(),
      closeLnurlWithdrawConfirmation: () =>
        commands?.read().closeLnurlWithdrawConfirmation(),
      closePaymentMintMeltConfirmation: () =>
        commands?.read().closePaymentMintMeltConfirmation(),
      confirmCashuPaymentRequest: async () =>
        commands?.read().confirmCashuPaymentRequest(),
      enterCashuPaymentRequestAmount: async (amountSat: number) =>
        commands?.read().enterCashuPaymentRequestAmount(amountSat),
      confirmLightningInvoicePayment: async () =>
        commands?.read().confirmLightningInvoicePayment(),
      confirmLnurlWithdraw: async () => commands?.read().confirmLnurlWithdraw(),
      confirmPaymentMintMelt: async () =>
        commands?.read().confirmPaymentMintMelt(),
      payChatPaymentRequest: async (
        message: LocalNostrMessage,
        request: CashuPaymentRequestMessageInfo,
      ) => commands?.read().payChatPaymentRequest(message, request),
      payLightningAddressWithCashu: async (
        lnAddress: string,
        amountSat: number,
        comment: string | null,
      ) =>
        commands
          ?.read()
          .payLightningAddressWithCashu(lnAddress, amountSat, comment),
      payLightningInvoiceWithCashu: async (invoice: string) =>
        (await commands?.read().payLightningInvoiceWithCashu(invoice)) ?? false,
      paySelectedContact: async (options: { note: string | null }) =>
        commands?.read().paySelectedContact(options),
      reclaimHandedOutTokens: async () =>
        commands?.read().reclaimHandedOutTokens(),
      requestSelectedContact: async (options: { note: string | null }) =>
        commands?.read().requestSelectedContact(options),
      restoreAndReclaimAllTokens: async () =>
        commands?.read().restoreAndReclaimAllTokens(),
      restoreMissingTokens: async () => commands?.read().restoreMissingTokens(),
      saveCashuFromText: async (
        text: string,
        options: { navigateToTokens?: boolean; navigateToWallet?: boolean },
      ) => commands?.read().saveCashuFromText(text, options),
      settleBankPaymentOffer: async (message: LocalNostrMessage) =>
        commands?.read().settleBankPaymentOffer(message),
    }),
    [commands],
  );
};
