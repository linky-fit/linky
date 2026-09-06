import React from "react";
import { parseStatusFilterValue } from "../../../nostrStatus";
import { ARCHIVED_CONTACTS_FILTER } from "../../../utils/constants";
import type { ContactIdLike, ContactNameRowLike } from "../../types/appTypes";

type ContactRow = ContactNameRowLike;

interface ContactsSearchItem<TContact extends ContactRow> {
  contact: TContact;
  groupNames?: readonly string[];
  haystack: string;
  idKey: string | null;
  statusFilterValues?: readonly string[];
}

interface LastMessageRow {
  createdAtSec?: number | null | undefined;
}

interface UseVisibleContactsParams<TContact extends ContactRow> {
  activeGroup: string | null;
  contactNameCollator: Intl.Collator;
  contactsSearchData: readonly ContactsSearchItem<TContact>[];
  contactsSearchParts: readonly string[];
  lastMessageByContactId: ReadonlyMap<string, LastMessageRow>;
  noGroupFilterValue: string;
  pinnedContactId: ContactIdLike;
  // Unread conversations only; the value is the newest incoming message time.
  unreadByContactId: ReadonlyMap<string, number>;
}

interface VisibleContactsResult<TContact extends ContactRow> {
  conversations: TContact[];
  others: TContact[];
  pinned: TContact[];
}

export const useVisibleContacts = <TContact extends ContactRow>({
  activeGroup,
  contactNameCollator,
  contactsSearchData,
  contactsSearchParts,
  lastMessageByContactId,
  noGroupFilterValue,
  pinnedContactId,
  unreadByContactId,
}: UseVisibleContactsParams<TContact>): VisibleContactsResult<TContact> => {
  return React.useMemo(() => {
    const isArchivedContact = (contact: TContact): boolean => {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      return Number.isFinite(archivedAtSec) && archivedAtSec > 0;
    };

    const isUnknownContact = (contact: TContact): boolean => {
      return contact.isUnknownContact === true;
    };

    const matchesSearch = (item: (typeof contactsSearchData)[number]) => {
      if (contactsSearchParts.length === 0) return true;
      return contactsSearchParts.every((part) => item.haystack.includes(part));
    };

    const filtered = (() => {
      if (!activeGroup) {
        return contactsSearchData.filter(
          (item) => !isArchivedContact(item.contact),
        );
      }
      if (activeGroup === ARCHIVED_CONTACTS_FILTER) {
        return contactsSearchData.filter(
          (item) =>
            isArchivedContact(item.contact) && !isUnknownContact(item.contact),
        );
      }
      if (activeGroup === noGroupFilterValue) {
        return contactsSearchData.filter(
          (item) =>
            (item.groupNames ?? []).length === 0 &&
            !isArchivedContact(item.contact),
        );
      }
      const statusFilterCurrency = parseStatusFilterValue(activeGroup);
      if (statusFilterCurrency) {
        return contactsSearchData.filter(
          (item) =>
            !isArchivedContact(item.contact) &&
            (item.statusFilterValues ?? []).includes(statusFilterCurrency),
        );
      }
      return contactsSearchData.filter(
        (item) =>
          (item.groupNames ?? []).includes(activeGroup) &&
          !isArchivedContact(item.contact),
      );
    })();

    const searchFiltered = contactsSearchParts.length
      ? filtered.filter(matchesSearch)
      : filtered;

    const pinnedIdKey = pinnedContactId ?? "";
    const pinned: TContact[] = [];
    const withConversation: TContact[] = [];
    const withoutConversation: TContact[] = [];

    for (const item of searchFiltered) {
      const key = item.idKey;
      const contact = item.contact;
      if (pinnedIdKey && key === pinnedIdKey) {
        pinned.push(contact);
        continue;
      }
      if (key && lastMessageByContactId.has(key)) {
        withConversation.push(contact);
      } else {
        withoutConversation.push(contact);
      }
    }

    const sortWithConversation = (a: TContact, b: TContact) => {
      const aKey = a.id ?? "";
      const bKey = b.id ?? "";
      const aUnreadAt = aKey ? (unreadByContactId.get(aKey) ?? 0) : 0;
      const bUnreadAt = bKey ? (unreadByContactId.get(bKey) ?? 0) : 0;
      if (aUnreadAt !== bUnreadAt) return bUnreadAt - aUnreadAt;

      const aMsg = aKey ? lastMessageByContactId.get(aKey) : null;
      const bMsg = bKey ? lastMessageByContactId.get(bKey) : null;
      const aAt = aMsg ? (aMsg.createdAtSec ?? 0) || 0 : 0;
      const bAt = bMsg ? (bMsg.createdAtSec ?? 0) || 0 : 0;
      if (aAt !== bAt) return bAt - aAt;

      return contactNameCollator.compare(a.name ?? "", b.name ?? "");
    };

    const sortWithoutConversation = (a: TContact, b: TContact) => {
      const aKey = a.id ?? "";
      const bKey = b.id ?? "";
      const aUnreadAt = aKey ? (unreadByContactId.get(aKey) ?? 0) : 0;
      const bUnreadAt = bKey ? (unreadByContactId.get(bKey) ?? 0) : 0;
      if (aUnreadAt !== bUnreadAt) return bUnreadAt - aUnreadAt;

      const aCreatedAt = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bCreatedAt = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;

      return contactNameCollator.compare(a.name ?? "", b.name ?? "");
    };

    return {
      conversations: [...withConversation].sort(sortWithConversation),
      others: [...withoutConversation].sort(sortWithoutConversation),
      pinned,
    };
  }, [
    activeGroup,
    contactNameCollator,
    contactsSearchData,
    contactsSearchParts,
    lastMessageByContactId,
    noGroupFilterValue,
    pinnedContactId,
    unreadByContactId,
  ]);
};
