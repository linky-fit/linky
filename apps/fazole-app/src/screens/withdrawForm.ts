import { encodeNpub } from "@linky-fit/linkstr";
import { copy } from "../copy";
import {
  DEFAULT_CONTACT_DOMAIN,
  parseContactInput,
  parseSats,
  parseWithdrawTarget,
  type WithdrawTarget,
} from "../domain";
import { formatWhole } from "../format";
import { contactFailureText, type ContactState } from "./contactState";

export interface WithdrawForm {
  /** The recipient the text names, once it is known. */
  readonly target: WithdrawTarget | null;
  /** A Linky name is still being looked up. */
  readonly resolving: boolean;
  readonly targetError: string | undefined;
  readonly targetHint: string | undefined;
  /** An invoice fixes the amount, so the amount field hides. */
  readonly amountEditable: boolean;
  /** The sats to send; `undefined` sends the whole balance with the fees deducted from it. */
  readonly amountSats: number | undefined;
  readonly amountError: string | undefined;
  readonly ready: boolean;
}

/**
 * Whether the text names a Linky user by NIP-05 (`hynek`, `hynek@linky.fit`),
 * which a lookup turns into a key. Other `name@domain` texts are Lightning
 * addresses.
 */
export const needsContactLookup = (text: string): boolean => {
  const contact = parseContactInput(text);
  return contact?.kind === "nip05" && contact.domain === DEFAULT_CONTACT_DOMAIN;
};

/** Whether a scanned or pasted text names a recipient. */
export const acceptsTarget = (text: string): boolean =>
  parseContactInput(text) !== null || parseWithdrawTarget(text) !== null;

/**
 * Reads the withdraw form as typed: a key, a Linky name (looked up, `lookup`
 * is where that stands), a Lightning address or an invoice. Lookup failures
 * show at once, an unreadable recipient once `submitted`; an empty amount
 * means the whole balance.
 */
export const readWithdrawForm = (
  targetText: string,
  lookup: ContactState,
  amountText: string,
  submitted: boolean,
): WithdrawForm => {
  const text = targetText.trim();
  const contact = parseContactInput(text);
  let target: WithdrawTarget | null = null;
  let resolving = false;
  let lookupError: string | undefined;
  if (contact?.kind === "pubkey") {
    target = {
      kind: "cashu_chat",
      pubkey: contact.pubkey,
      npub: encodeNpub(contact.pubkey),
    };
  } else if (needsContactLookup(text)) {
    switch (lookup.kind) {
      case "resolved":
        target = {
          kind: "cashu_chat",
          pubkey: lookup.contact.pubkey,
          npub: encodeNpub(lookup.contact.pubkey),
          address: lookup.contact.address ?? undefined,
        };
        break;
      case "failed":
        lookupError = contactFailureText(lookup.failure, lookup.address);
        break;
      default:
        resolving = true;
    }
  } else {
    target = parseWithdrawTarget(text);
  }
  const amountEditable = target?.kind !== "lightning_invoice";
  const typedAmount =
    amountText.trim() === "" ? undefined : parseSats(amountText);
  const amountSats =
    target?.kind === "lightning_invoice"
      ? target.amountSats
      : (typedAmount ?? undefined);
  const amountInvalid = amountEditable && typedAmount === null;
  return {
    target,
    resolving,
    targetError:
      lookupError ??
      (target === null && submitted && !resolving
        ? copy.withdraw.targetInvalid
        : undefined),
    targetHint:
      target?.kind === "lightning_invoice"
        ? copy.withdraw.invoiceAmount(formatWhole(target.amountSats))
        : undefined,
    amountEditable,
    amountSats,
    amountError: amountInvalid ? copy.withdraw.amountInvalid : undefined,
    ready: target !== null && !amountInvalid,
  };
};
