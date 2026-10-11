import type { ContactsRepository } from "@linky-fit/linksync";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { isStatusFilterValue } from "../../nostrStatus";
import type { Route } from "../../types/route";
import { ARCHIVED_CONTACTS_FILTER } from "../../utils/constants";
import { getContactGroups } from "../../utils/contactGroups";
import {
  contactGroupsAtom,
  contactRowsAtom,
  contactsAtom,
  conversationRowsAtom,
} from "../state/contacts/readModel";
import { useConversationArchiveMigration } from "../migrations/useConversationArchiveMigration";

interface UseContactsDomainParams {
  accountHydrated: boolean;
  contacts: ContactsRepository;
  noGroupFilterValue: string;
  route: Route;
}

export const useContactsDomain = ({
  accountHydrated,
  contacts: contactsRepository,
  noGroupFilterValue,
  route,
}: UseContactsDomainParams) => {
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);
  const [contactsSearch, setContactsSearch] = React.useState("");
  const [contactsFilterOpen, setContactsFilterOpen] = React.useState(false);

  const contactsSearchInputRef = React.useRef<HTMLInputElement | null>(null);

  const toggleContactsFilter = React.useCallback(() => {
    setContactsFilterOpen(!contactsFilterOpen);
    if (contactsFilterOpen) return;
    requestAnimationFrame(() => {
      contactsSearchInputRef.current?.focus();
    });
  }, [contactsFilterOpen]);

  const contactRows = useAtomValue(contactRowsAtom);
  const conversationRows = useAtomValue(conversationRowsAtom);
  useConversationArchiveMigration({
    contactRows,
    contactsRepository,
    conversationRows,
    hydrated: accountHydrated,
  });

  const contacts = useAtomValue(contactsAtom);

  const { groupCounts, groupNames, ungroupedCount } =
    useAtomValue(contactGroupsAtom);

  React.useEffect(() => {
    if (!activeGroup) return;
    if (activeGroup === noGroupFilterValue) return;
    if (activeGroup === ARCHIVED_CONTACTS_FILTER) return;
    if (isStatusFilterValue(activeGroup)) return;
    if (!groupNames.includes(activeGroup)) {
      setActiveGroup(null);
    }
  }, [activeGroup, groupNames, noGroupFilterValue]);

  const contactsSearchParts = React.useMemo(() => {
    const normalized = contactsSearch.trim().toLowerCase();

    if (!normalized) return [];
    return normalized.split(/\s+/).filter(Boolean);
  }, [contactsSearch]);

  const contactsSearchData = React.useMemo(() => {
    return contacts.map((contact) => {
      const idKey = contact.id.trim();
      const groupNames = getContactGroups(contact);
      const haystack = [
        contact.name,
        contact.npub,
        contact.lnAddress,
        ...groupNames,
      ]
        .map((value) => (value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");

      return { contact, idKey, groupNames, haystack };
    });
  }, [contacts]);

  const selectedContact = React.useMemo(() => {
    const id =
      route.kind === "contact" ||
      route.kind === "contactEdit" ||
      route.kind === "contactPay" ||
      route.kind === "chat"
        ? route.id
        : route.kind === "bankPaymentOffer"
          ? route.chatId
          : null;

    if (!id) return null;
    return contacts.find((contact) => contact.id === id) ?? null;
  }, [contacts, route]);

  return {
    activeGroup,
    contacts,
    contactsFilterOpen,
    contactsSearch,
    contactsSearchData,
    contactsSearchInputRef,
    contactsSearchParts,
    groupCounts,
    groupNames,
    selectedContact,
    setActiveGroup,
    setContactsSearch,
    toggleContactsFilter,
    ungroupedCount,
  };
};
