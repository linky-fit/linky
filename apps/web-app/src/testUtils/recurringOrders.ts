import {
  createIdFromString,
  type ContactId,
  type RecurringPaymentId,
} from "@linky-fit/linksync";
import { recurringOrderFixture as baseFixture } from "@linky-fit/recurring-payment/testing";
import type { RecurringPaymentOrder } from "../app/lib/recurringPaymentStore";

export { DUE, HOUR } from "@linky-fit/recurring-payment/testing";

export const recurringPaymentIdFor = (key: string): RecurringPaymentId =>
  createIdFromString<"RecurringPayment">(`test/recurring/${key}`);

export const contactIdFor = (key: string): ContactId =>
  createIdFromString<"Contact">(`test/contact/${key}`);

/** The package fixture with this app's branded ids. */
export const recurringOrderFixture = (
  overrides: Partial<RecurringPaymentOrder> = {},
): RecurringPaymentOrder => ({
  ...baseFixture(),
  id: recurringPaymentIdFor("rp-1"),
  contactId: contactIdFor("contact-1"),
  ...overrides,
});
