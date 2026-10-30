import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import type { LocalNostrMessage } from "../../types/appTypes";
import { ownerCommandsAtom } from "../shell/ownerCommands";

/** What paying a transfer's request shows for review, checks while it runs and does once it is paid. */
export interface OnchainTransferPaymentOptions {
  readonly isPaymentAuthorized: () => boolean;
  readonly onPaid: () => void;
  /** Shown as the payee, ahead of a saved contact's name. */
  readonly recipientName: string;
  readonly summary: string;
}

export interface WalletCommands {
  readonly payLightningInvoiceWithCashu: (
    invoice: string,
    /** What an amountless invoice is paid with. */
    amountSat?: number,
  ) => Promise<boolean>;
  readonly payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
    comment: string | null,
  ) => Promise<void>;
  /** Pays the contact the pay screen shows, the amount its draft holds. */
  readonly paySelectedContact: (options: {
    note: string | null;
  }) => Promise<void>;
  /** Asks the contact the pay screen shows for its draft amount. */
  readonly requestSelectedContact: (options: {
    note: string | null;
  }) => Promise<void>;
  readonly payChatPaymentRequest: (
    message: LocalNostrMessage,
    request: CashuPaymentRequestMessageInfo,
  ) => Promise<void>;
  /** Pays the operator for an on-chain send while `isPaymentAuthorized` holds; `onPaid` runs once it is paid. */
  readonly payOnchainTransferPaymentRequest: (
    request: CashuPaymentRequestMessageInfo,
    options: OnchainTransferPaymentOptions,
  ) => Promise<void>;
  /** Pays the payer of a proxy offer whose bank transfer arrived. */
  readonly settleBankPaymentOffer: (
    message: LocalNostrMessage,
  ) => Promise<void>;
  readonly saveCashuFromText: (
    text: string,
    options: { navigateToTokens?: boolean; navigateToWallet?: boolean },
  ) => Promise<void>;
  readonly restoreMissingTokens: () => Promise<void>;
  readonly reclaimHandedOutTokens: () => Promise<void>;
  readonly restoreAndReclaimAllTokens: () => Promise<void>;
  readonly confirmLightningInvoicePayment: () => Promise<void>;
  readonly closeLightningInvoiceConfirmation: () => void;
  readonly confirmCashuPaymentRequest: () => Promise<void>;
  /** Prices the amount the user entered for an amountless payment request. */
  readonly enterCashuPaymentRequestAmount: (amountSat: number) => Promise<void>;
  readonly closeCashuPaymentRequestConfirmation: () => void;
  readonly confirmPaymentMintMelt: () => Promise<void>;
  readonly closePaymentMintMeltConfirmation: () => void;
  readonly confirmLnurlWithdraw: () => Promise<void>;
  readonly closeLnurlWithdrawConfirmation: () => void;
}

/**
 * The wallet composition's payments, token recovery and payment
 * confirmations: one instance, so a payment's exclusive run and its pending
 * confirmation stay single.
 */
export const walletCommandsAtom = ownerCommandsAtom<WalletCommands>();
