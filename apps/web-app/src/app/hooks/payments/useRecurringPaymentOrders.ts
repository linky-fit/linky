import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React from "react";
import { evolu } from "../../../evolu";
import { asNonEmptyString } from "../../../utils/validation";
import {
  readRecurringPaymentOrder,
  type RecurringPaymentOrder,
} from "../../lib/recurringPaymentOrder";

/** Live standing orders, soonest due first. */
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

export const recurringRecipientLabel = (
  order: RecurringPaymentOrder,
  contacts: ReadonlyMap<string, RecurringContactSummary>,
): string => {
  if (order.recipient.kind === "lnAddress") return order.recipient.lnAddress;
  const contact = contacts.get(order.recipient.contactId);
  return contact?.name ?? contact?.lnAddress ?? contact?.npub ?? "?";
};
