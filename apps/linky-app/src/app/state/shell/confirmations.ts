import type {
  LightningInvoicePreview,
  LnurlAuthPreview,
  LnurlWithdrawPreview,
} from "@linky-fit/linkshu";
import { Atom } from "effect/reactivity";
import type { PendingSiteLogin } from "../../../siteLogin";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import type { PaymentRequestQuote } from "../wallet/payments";
import { ownerCommandsAtom } from "./ownerCommands";

/** A scanned invoice above the auto-pay limit, waiting for the user to pay it. */
export const pendingLightningInvoiceAtom = Atom.keepAlive(
  Atom.make<LightningInvoicePreview | null>(null),
);

export interface PendingCashuPaymentRequest {
  readonly request: CashuPaymentRequestMessageInfo;
  /** Null until the user entered the amount of an amountless request. */
  readonly quote: PaymentRequestQuote | null;
  /** The chat message that carried the request and its conversation's contact. */
  readonly chat: {
    readonly message: LocalNostrMessage;
    readonly contact: ContactRowLike;
  } | null;
  /** The request pays someone other than the chat's contact. */
  readonly recipientDiffers: boolean;
  /** The last entered amount no mint covers. */
  readonly insufficientAmount: number | null;
  /** Shown instead of the payee's npub: the saved contact's name, else a name the caller knows. */
  readonly recipientName?: string | undefined;
  /** Shown instead of the request's description, e.g. what an on-chain send pays out and where. */
  readonly summary?: string | undefined;
  /** Runs once the request is paid instead of opening the payee's chat, e.g. to record an on-chain transfer as sent and stay on it. */
  readonly onPaid?: (() => void) | undefined;
  /** Whether the request may still be paid; checked before anything moves and again before the payload is sent. */
  readonly isPaymentAuthorized?: (() => boolean) | undefined;
}

/** A payment request the user has to review, enter the amount of or agree to a new mint for. */
export const pendingCashuPaymentRequestAtom = Atom.keepAlive(
  Atom.make<PendingCashuPaymentRequest | null>(null),
);

export interface MintMoveConfirmation {
  readonly fromMint: string;
  readonly toMint: string;
}

/** A payment the default mint cannot cover until the user moves funds into it. */
export const pendingPaymentMintMoveAtom = Atom.keepAlive(
  Atom.make<MintMoveConfirmation | null>(null),
);

export interface PostPaySaveContact {
  readonly amountSat: number;
  readonly lnAddress: string;
}

/** A lightning address just paid that is not a contact yet. */
export const postPaySaveContactAtom = Atom.keepAlive(
  Atom.make<PostPaySaveContact | null>(null),
);

export const pendingLnurlWithdrawAtom = Atom.keepAlive(
  Atom.make<LnurlWithdrawPreview | null>(null),
);
export const lnurlWithdrawBusyAtom = Atom.keepAlive(Atom.make(false));

export const pendingLnurlAuthAtom = Atom.keepAlive(
  Atom.make<LnurlAuthPreview | null>(null),
);
export const lnurlAuthBusyAtom = Atom.keepAlive(Atom.make(false));
/** The approved LNURL-auth sheet stays up in its done state for a moment. */
export const lnurlAuthDoneAtom = Atom.keepAlive(Atom.make(false));

export const pendingSiteLoginAtom = Atom.keepAlive(
  Atom.make<PendingSiteLogin | null>(null),
);
export const siteLoginBusyAtom = Atom.keepAlive(Atom.make(false));
/** The approved site login sheet stays up in its done state for a moment. */
export const siteLoginDoneAtom = Atom.keepAlive(Atom.make(false));

export interface LoginCommands {
  readonly closeLnurlAuthConfirmation: () => void;
  readonly confirmLnurlAuth: () => Promise<void>;
  readonly closeSiteLoginConfirmation: () => void;
  readonly confirmSiteLogin: () => Promise<void>;
}

/** Answers to LNURL-auth and site login requests, run by the shell's signers. */
export const loginCommandsAtom = ownerCommandsAtom<LoginCommands>();
