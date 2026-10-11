import type { ContactId } from "@linky-fit/linksync";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { Route } from "../../../types/route";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { contactsAtom } from "../../state/contacts/readModel";
import { lnAddressPayAtom } from "../../state/wallet/contactPay";
import { useNostrPictureByNpub } from "../contacts/useProfileCache";

/** The lightning address pay screen's amount and note, with `useState`-style setters. */
export const useLnAddressPayDraft = () => {
  const [draft, setDraft] = useAtom(lnAddressPayAtom);
  const setters = React.useMemo(
    () => ({
      setLnAddressPayAmount: (action: React.SetStateAction<string>) =>
        setDraft((current) => ({
          ...current,
          amount:
            typeof action === "function" ? action(current.amount) : action,
        })),
      setLnAddressPayNote: (note: string) =>
        setDraft((current) => ({ ...current, note })),
      setLnAddressPayContactId: (contactId: ContactId | null) =>
        setDraft((current) => ({ ...current, contactId })),
      setLnAddressPay: (pay: {
        amount: string;
        note: string;
        contactId: ContactId;
      }) => setDraft(pay),
    }),
    [setDraft],
  );
  return {
    lnAddressPayAmount: draft.amount,
    lnAddressPayContactId: draft.contactId,
    lnAddressPayNote: draft.note,
    ...setters,
  };
};

// Only a contact the user chose to pay; a lightning address never identifies one.
export const useKnownLnAddressPayContact = (routeKind: Route["kind"]) => {
  const contactId = useAtomValue(lnAddressPayAtom, (draft) => draft.contactId);
  const contacts = useAtomValue(contactsAtom);
  const nostrPictureByNpub = useNostrPictureByNpub();
  const knownLnAddressPayContact = React.useMemo(
    () =>
      routeKind === "lnAddressPay" && contactId
        ? (contacts.find((contact) => contact.id === contactId) ?? null)
        : null,
    [contactId, contacts, routeKind],
  );
  const knownLnAddressPayContactPictureUrl = React.useMemo(() => {
    const npub = normalizeNpubIdentifier(knownLnAddressPayContact?.npub ?? "");
    return npub ? (nostrPictureByNpub[npub] ?? null) : null;
  }, [knownLnAddressPayContact, nostrPictureByNpub]);
  return { knownLnAddressPayContact, knownLnAddressPayContactPictureUrl };
};
