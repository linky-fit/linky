import type { RecurringRail } from "@linky-fit/recurring-payment";
import type { ContactRowLike } from "../types/appTypes";

type RailContact = Pick<ContactRowLike, "lnAddress" | "npub">;

/** Where a run on `rail` goes: the contact's npub on Cashu, its Lightning address on Lightning. */
export const recurringRecipient = (
  contact: RailContact | undefined,
  rail: RecurringRail,
): string | null =>
  (rail === "cashu" ? contact?.npub : contact?.lnAddress)?.trim() || null;

/**
 * The rail a new order is bound to: Cashu when the contact has an npub and
 * paying with Cashu is on, else Lightning when it has a Lightning address.
 */
export const pickRecurringRail = (
  contact: RailContact | undefined,
  payWithCashuEnabled: boolean,
): RecurringRail | null => {
  if (payWithCashuEnabled && recurringRecipient(contact, "cashu")) {
    return "cashu";
  }
  return recurringRecipient(contact, "lightning") ? "lightning" : null;
};
