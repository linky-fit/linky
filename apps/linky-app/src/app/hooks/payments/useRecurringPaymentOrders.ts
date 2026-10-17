import React from "react";
import { isDeletedContact } from "../../../utils/contactName";
import { formatShortNpub } from "../../../utils/formatting";
import { asNonEmptyString } from "../../../utils/validation";
import {
  readRecurringPaymentOrder,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import { useContactRows, useRecurringPaymentRecords } from "../useLinksync";

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

export interface RecurringContactSummary {
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
  deleted: boolean;
}

interface ContactRowLike {
  readonly archivedAtSec?: number | string | null | undefined;
  readonly id: string;
  readonly lnAddress?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly npub?: string | null | undefined;
}

/** Saved contacts by id, deleted ones included so a recurring payment to one still names it. */
export const recurringContactSummaries = (
  rows: readonly ContactRowLike[],
): Map<string, RecurringContactSummary> => {
  const byId = new Map<string, RecurringContactSummary>();
  for (const row of rows) {
    const id = asNonEmptyString(row.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      lnAddress: asNonEmptyString(row.lnAddress),
      name: asNonEmptyString(row.name),
      npub: asNonEmptyString(row.npub),
      deleted: isDeletedContact(row),
    });
  }
  return byId;
};

/** Saved contacts by id, for naming recipients and picking a payee. */
export const useRecurringContactSummaries = (): Map<
  string,
  RecurringContactSummary
> => {
  const rows = useContactRows();
  return React.useMemo(() => recurringContactSummaries(rows), [rows]);
};

/** A contact a new recurring payment can go to. */
export const isPayableContact = (contact: RecurringContactSummary): boolean =>
  !contact.deleted && (contact.npub !== null || contact.lnAddress !== null);

export const contactSummaryLabel = (contact: RecurringContactSummary): string =>
  contact.name ??
  contact.lnAddress ??
  (contact.npub ? formatShortNpub(contact.npub) : "?");

export const recurringRecipientLabel = (
  order: RecurringPaymentOrder,
  contacts: ReadonlyMap<string, RecurringContactSummary>,
): string => {
  const contact = contacts.get(order.contactId);
  return contact ? contactSummaryLabel(contact) : "?";
};
