import type {
  LightningInvoicePreview,
  LnurlAuthPreview,
  LnurlWithdrawPreview,
} from "@linky-fit/linkshu";
import { Atom } from "effect/reactivity";
import type { PendingSiteLogin } from "../../../siteLogin";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { ownerCommandsAtom } from "./ownerCommands";

/** A scanned invoice above the auto-pay limit, waiting for the user to pay it. */
export const pendingLightningInvoiceAtom = Atom.keepAlive(
  Atom.make<LightningInvoicePreview | null>(null),
);

/** A payment request above the auto-pay limit, waiting for the user to pay it. */
export const pendingCashuPaymentRequestAtom = Atom.keepAlive(
  Atom.make<CashuPaymentRequestMessageInfo | null>(null),
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
