import React from "react";
import {
  readRecurringPaymentOrder,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import {
  contactSummaryLabel,
  type ContactSummary,
} from "../contacts/useContactSummaries";
import { useRecurringPaymentRecords } from "../useLinksync";

/** Live recurring payments, soonest due first. */
export const useRecurringPaymentOrders = (): RecurringPaymentOrder[] => {
  const records = useRecurringPaymentRecords();
  return React.useMemo(
    () =>
      records
        .flatMap((record) => {
          const order = readRecurringPaymentOrder(record);
          return order === null ? [] : [order];
        })
        .sort((a, b) => a.schedule.nextDueAtSec - b.schedule.nextDueAtSec),
    [records],
  );
};

export const recurringRecipientLabel = (
  order: RecurringPaymentOrder,
  contacts: ReadonlyMap<string, ContactSummary>,
): string => {
  const contact = contacts.get(order.contactId);
  return contact ? contactSummaryLabel(contact) : "?";
};
