import { copy } from "../copy";
import { MAX_AMOUNT, parseCzkInput, type CzkAmount } from "../domain";
import type { ResolvedContact } from "../services/contacts";
import { contactFailureText, type ContactState } from "./contactState";

export interface CashForm {
  readonly contact: ResolvedContact | null;
  readonly contactError: string | undefined;
  readonly amountCzk: CzkAmount | null;
  readonly amountError: string | undefined;
  readonly ready: boolean;
}

/**
 * Reads the cash form: a looked-up contact and a CZK amount. A lookup
 * failure shows at once; an empty or unreadable field only once `submitted`.
 */
export const readCashForm = (
  contactState: ContactState,
  amountText: string,
  submitted: boolean,
): CashForm => {
  const contact =
    contactState.kind === "resolved" ? contactState.contact : null;
  const contactError =
    contactState.kind === "failed"
      ? contactFailureText(contactState.failure, contactState.address)
      : contactState.kind === "idle" && submitted
        ? copy.contact.invalid
        : undefined;
  const parsed = parseCzkInput(amountText);
  const amountCzk = parsed !== null && parsed <= MAX_AMOUNT ? parsed : null;
  const amountError =
    amountCzk === null && (submitted || amountText.trim() !== "")
      ? copy.cash.amountInvalid
      : undefined;
  return {
    contact,
    contactError,
    amountCzk,
    amountError,
    ready: contact !== null && amountCzk !== null,
  };
};
