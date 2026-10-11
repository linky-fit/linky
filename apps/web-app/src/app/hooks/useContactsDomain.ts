import type { ContactsRepository } from "@linky-fit/linksync";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { isStatusFilterValue } from "../../nostrStatus";
import type { Route } from "../../types/route";
import { ARCHIVED_CONTACTS_FILTER } from "../../utils/constants";
import { activeContactGroupAtom } from "../state/contacts/contactsList";
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
  const [activeGroup, setActiveGroup] = useAtom(activeContactGroupAtom);

  const contactRows = useAtomValue(contactRowsAtom);
  const conversationRows = useAtomValue(conversationRowsAtom);
  useConversationArchiveMigration({
    contactRows,
    contactsRepository,
    conversationRows,
    hydrated: accountHydrated,
  });

  const contacts = useAtomValue(contactsAtom);

  const { groupNames } = useAtomValue(contactGroupsAtom);

  React.useEffect(() => {
    if (!activeGroup) return;
    if (activeGroup === noGroupFilterValue) return;
    if (activeGroup === ARCHIVED_CONTACTS_FILTER) return;
    if (isStatusFilterValue(activeGroup)) return;
    if (!groupNames.includes(activeGroup)) {
      setActiveGroup(null);
    }
  }, [activeGroup, groupNames, noGroupFilterValue, setActiveGroup]);

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
    selectedContact,
    setActiveGroup,
  };
};
