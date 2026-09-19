import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React from "react";
import { evolu } from "../../../evolu";
import { formatShortNpub } from "../../../utils/formatting";
import { asNonEmptyString } from "../../../utils/validation";
import {
  readRecurringPaymentOrder,
  type RecurringPaymentOrder,
} from "../../lib/recurringPaymentOrder";

/** Live recurring payments, soonest due first. */
export const useRecurringPaymentOrders = (): RecurringPaymentOrder[] => {
  const query = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("recurringPayment")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const rows = useQuery(query);
  return React.useMemo(
    () =>
      rows
        .flatMap((row) => {
          const order = readRecurringPaymentOrder(row);
          return order === null ? [] : [order];
        })
        .sort((a, b) => a.schedule.nextDueAtSec - b.schedule.nextDueAtSec),
    [rows],
  );
};

export interface RecurringContactSummary {
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
}

/** Saved contacts by id, for naming recipients and picking a payee. */
export const useRecurringContactSummaries = (): Map<
  string,
  RecurringContactSummary
> => {
  const query = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("contact")
          .select(["id", "lnAddress", "name", "npub"])
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const rows = useQuery(query);
  return React.useMemo(() => {
    const byId = new Map<string, RecurringContactSummary>();
    for (const row of rows) {
      const id = asNonEmptyString(row.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        lnAddress: asNonEmptyString(row.lnAddress),
        name: asNonEmptyString(row.name),
        npub: asNonEmptyString(row.npub),
      });
    }
    return byId;
  }, [rows]);
};

export const isPayableContact = (contact: RecurringContactSummary): boolean =>
  contact.npub !== null || contact.lnAddress !== null;

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
