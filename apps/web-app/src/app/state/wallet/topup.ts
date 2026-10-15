import type { TopupQuote } from "@linky-fit/linkshu";
import type { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
import { Atom } from "effect/reactivity";

/** The topup the invoice screen shows; `useTopupFlow` starts and settles it. */
export interface ActiveTopup {
  readonly amountSat: number;
  readonly mint: string;
  readonly note: string | null;
  readonly quote: TopupQuote;
  /** The cashu request id the QR carries; never the quote id, which must stay in the wallet. */
  readonly requestId: PaymentRequestId;
}

export const topupAmountAtom = Atom.keepAlive(Atom.make(""));
export const topupNoteAtom = Atom.keepAlive(Atom.make(""));
export const activeTopupAtom = Atom.keepAlive(
  Atom.make<ActiveTopup | null>(null),
);
export const topupInvoiceErrorAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);
export const topupInvoiceBusyAtom = Atom.keepAlive(Atom.make(false));
/** The QR's BIP-321 URI: the invoice plus a cashu payment request when one fits. */
export const topupInvoiceQrPayloadAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);
export const topupInvoiceCashuRequestAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);
