import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import { getBankPaymentOfferCurrency } from "@linky-fit/proxy-payment";
import React from "react";
import { useRouting } from "../../../hooks/useRouting";
import {
  buildStatusFilterValue,
  parseProfileGeneralStatus,
} from "../../../nostrStatus";
import { NO_GROUP_FILTER } from "../../../utils/constants";
import { getContactGroups } from "../../../utils/contactGroups";
import { isDeletedContact } from "../../../utils/contactName";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  activeContactGroupAtom,
  contactsFilterOpenAtom,
  contactsSearchAtom,
  contactsSearchInputRefAtom,
  unreadByContactIdAtom,
} from "../../state/contacts/contactsList";
import { recentlyAddedContactIdAtom } from "../../state/contacts/contactForm";
import { lastVisibleMessageByContactIdAtom } from "../../state/contacts/displayContacts";
import { contactGroupsAtom } from "../../state/contacts/readModel";
import { useRecentBankPaymentOfferOutcomes } from "../useBankPaymentOffers";
import { useTranslation } from "../shell";
import {
  useDisplayContacts,
  useNostrStatusByNpub,
  type DisplayContact,
} from "./useDisplayContacts";
import { useNostrPictureByNpub } from "./useProfileCache";
import { useVisibleContacts } from "./useVisibleContacts";

/** How many unarchived contacts offer each currency in their profile status, most offered first. */
export const statusFilterSummary = (
  displayContacts: readonly DisplayContact[],
  nostrStatusByNpub: Readonly<Record<string, string | null>>,
) => {
  const currencyCounts = new Map<string, number>();

  for (const contact of displayContacts) {
    if (isDeletedContact(contact)) continue;
    const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
    if (!normalizedNpub) continue;

    for (const currency of parseProfileGeneralStatus(
      nostrStatusByNpub[normalizedNpub],
    ).currencies) {
      currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
    }
  }

  const currencies = [...currencyCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([currency]) => currency);
  return {
    statusFilterCounts: currencyCounts,
    statusFilterCurrencies: currencies,
  };
};

export const useToggleContactsFilter = () => {
  const [contactsFilterOpen, setContactsFilterOpen] = useAtom(
    contactsFilterOpenAtom,
  );
  const contactsSearchInputRef = useAtomValue(contactsSearchInputRefAtom);
  return React.useCallback(() => {
    setContactsFilterOpen(!contactsFilterOpen);
    if (contactsFilterOpen) return;
    requestAnimationFrame(() => {
      contactsSearchInputRef.current?.focus();
    });
  }, [contactsFilterOpen, contactsSearchInputRef, setContactsFilterOpen]);
};

/** The contacts tab's filter options and its pinned, conversation and other sections. */
export const useContactsListView = () => {
  const route = useRouting();
  const { lang, t } = useTranslation();
  const activeGroup = useAtomValue(activeContactGroupAtom);
  const contactsSearch = useAtomValue(contactsSearchAtom);
  const { displayContacts } = useDisplayContacts();
  const nostrStatusByNpub = useNostrStatusByNpub();
  const { groupCounts, groupNames, ungroupedCount } =
    useAtomValue(contactGroupsAtom);
  const lastVisibleMessageByContactId = useAtomValue(
    lastVisibleMessageByContactIdAtom,
  );
  const unreadByContactId = useAtomValue(unreadByContactIdAtom);
  const recentlyAddedContactId = useAtomValue(recentlyAddedContactIdAtom);

  const contactNameCollator = React.useMemo(
    () =>
      new Intl.Collator(lang, {
        usage: "sort",
        numeric: true,
        sensitivity: "variant",
      }),
    [lang],
  );

  const contactsSearchParts = React.useMemo(() => {
    const normalized = contactsSearch.trim().toLowerCase();
    if (!normalized) return [];
    return normalized.split(/\s+/).filter(Boolean);
  }, [contactsSearch]);

  const displayContactsSearchData = React.useMemo(() => {
    return displayContacts.map((contact) => {
      const idKey = (contact.id ?? "").trim();
      const groupNames = getContactGroups(contact);
      const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
      const statusFilterValues = normalizedNpub
        ? parseProfileGeneralStatus(nostrStatusByNpub[normalizedNpub])
            .currencies
        : [];
      const haystack = [
        contact.name,
        contact.npub,
        contact.lnAddress,
        ...groupNames,
        contact.unknownPubkeyHex,
        ...statusFilterValues,
      ]
        .map((value) => (value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");

      return {
        contact,
        idKey,
        groupNames,
        haystack,
        statusFilterValues,
      };
    });
  }, [displayContacts, nostrStatusByNpub]);

  const { statusFilterCounts, statusFilterCurrencies } = React.useMemo(
    () => statusFilterSummary(displayContacts, nostrStatusByNpub),
    [displayContacts, nostrStatusByNpub],
  );
  const contactFilterOptions = React.useMemo(() => {
    const options: Array<{ count: number; label: string; value: string }> = [];
    if (ungroupedCount > 0) {
      options.push({
        count: ungroupedCount,
        label: t("noGroup"),
        value: NO_GROUP_FILTER,
      });
    }
    for (const groupName of groupNames) {
      options.push({
        count: groupCounts.get(groupName) ?? 0,
        label: groupName,
        value: groupName,
      });
    }
    for (const currency of statusFilterCurrencies) {
      options.push({
        count: statusFilterCounts.get(currency) ?? 0,
        label: currency,
        value: buildStatusFilterValue(currency),
      });
    }
    return options.sort((left, right) => {
      const leftIsNoGroup = left.value === NO_GROUP_FILTER;
      const rightIsNoGroup = right.value === NO_GROUP_FILTER;
      if (leftIsNoGroup !== rightIsNoGroup) return leftIsNoGroup ? 1 : -1;
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
  }, [
    groupCounts,
    groupNames,
    statusFilterCounts,
    statusFilterCurrencies,
    t,
    ungroupedCount,
  ]);

  const visibleContacts = useVisibleContacts<DisplayContact>({
    activeGroup,
    contactNameCollator,
    contactsSearchData: displayContactsSearchData,
    contactsSearchParts,
    lastMessageByContactId: lastVisibleMessageByContactId,
    noGroupFilterValue: NO_GROUP_FILTER,
    pinnedContactId: recentlyAddedContactId,
    unreadByContactId,
  });

  return {
    contactFilterOptions,
    showGroupFilter:
      route.kind === "contacts" &&
      (groupNames.length + statusFilterCurrencies.length > 0 ||
        ungroupedCount > 0),
    visibleContacts,
  };
};

/**
 * The contacts the bank QR's currency can be offered to, in the contacts
 * tab's order, with their pictures and how earlier offers went.
 */
export const useBankPaymentOfferContacts = (spdPayload: string) => {
  const { visibleContacts } = useContactsListView();
  const nostrStatusByNpub = useNostrStatusByNpub();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const recentBankPaymentOfferOutcomesByContactId =
    useRecentBankPaymentOfferOutcomes();
  const bankPaymentOfferCurrency = getBankPaymentOfferCurrency(spdPayload);

  return React.useMemo(() => {
    if (!bankPaymentOfferCurrency) return [];

    const sortedContacts = [
      ...visibleContacts.pinned,
      ...visibleContacts.conversations,
      ...visibleContacts.others,
    ];
    return sortedContacts.flatMap((contact) => {
      const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
      if (!normalizedNpub) return [];
      if (
        !parseProfileGeneralStatus(
          nostrStatusByNpub[normalizedNpub],
        ).currencies.includes(bankPaymentOfferCurrency)
      ) {
        return [];
      }

      return [
        {
          ...contact,
          pictureUrl: nostrPictureByNpub[normalizedNpub] ?? null,
          recentBankPaymentOfferOutcomes:
            recentBankPaymentOfferOutcomesByContactId.get(
              (contact.id ?? "").trim(),
            ) ?? [],
        },
      ];
    });
  }, [
    bankPaymentOfferCurrency,
    recentBankPaymentOfferOutcomesByContactId,
    nostrPictureByNpub,
    nostrStatusByNpub,
    visibleContacts.pinned,
    visibleContacts.conversations,
    visibleContacts.others,
  ]);
};
