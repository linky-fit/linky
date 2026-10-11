import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";

// The contact pay screen's draft; leaving the screen resets it.
export const payAmountAtom = Atom.keepAlive(Atom.make(""));
export const contactPaymentIntentAtom = Atom.keepAlive(
  Atom.make<"pay" | "request">("pay"),
);
/** Null until the screen picks the method the contact can be paid with. */
export const contactPayMethodAtom = Atom.keepAlive(
  Atom.make<"cashu" | "lightning" | null>(null),
);

/** The lightning address pay screen's draft, and the contact it was opened for. */
export interface LnAddressPayDraft {
  readonly amount: string;
  readonly note: string;
  readonly contactId: ContactId | null;
}

export const lnAddressPayAtom = Atom.keepAlive(
  Atom.make<LnAddressPayDraft>({ amount: "", note: "", contactId: null }),
);
