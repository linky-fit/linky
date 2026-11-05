import React from "react";
import { isDeletedContact } from "../../../utils/contactName";
import { formatShortNpub } from "../../../utils/formatting";
import { asNonEmptyString } from "../../../utils/validation";
import { useContactRows } from "../useLinksync";

export interface ContactSummary {
  deleted: boolean;
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
}

/** Saved contacts by id, deleted ones included so what they were paid still has a name. */
export const useContactSummaries = (): Map<string, ContactSummary> => {
  const rows = useContactRows();
  return React.useMemo(() => {
    const byId = new Map<string, ContactSummary>();
    for (const row of rows) {
      const id = asNonEmptyString(row.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        deleted: isDeletedContact(row),
        id,
        lnAddress: asNonEmptyString(row.lnAddress),
        name: asNonEmptyString(row.name),
        npub: asNonEmptyString(row.npub),
      });
    }
    return byId;
  }, [rows]);
};

export const isPayableContact = (contact: ContactSummary): boolean =>
  !contact.deleted && (contact.npub !== null || contact.lnAddress !== null);

export const contactSummaryLabel = (contact: ContactSummary): string =>
  contact.name ??
  contact.lnAddress ??
  (contact.npub ? formatShortNpub(contact.npub) : "?");
