import { getContactName } from "../../utils/contactName";
import { toContactTextFields } from "../lib/contactFields";
import {
  NonEmptyString1000,
  type ContactId,
  type ContactsRepository,
  type ConversationsRepository,
} from "@linky/linksync";
import { useRepositoryRows } from "@linky/linksync/react";
import React from "react";
import { isStatusFilterValue } from "../../nostrStatus";
import type { Route } from "../../types/route";
import { ARCHIVED_CONTACTS_FILTER } from "../../utils/constants";
import {
  getContactGroups,
  normalizeContactGroups,
  serializeContactGroups,
} from "../../utils/contactGroups";
import {
  joinContactChatState,
  type ContactWithChatState,
} from "../lib/contactChatState";
import { runWrite } from "../lib/storeWrite";
import type { Translate } from "../../i18n";

import { reportAppLog } from "../../devtools/inspector/appLog";

const withNormalizedName = (
  row: ContactWithChatState,
): ContactWithChatState => {
  const name = getContactName(row);
  if (name === (row.name ?? "")) return row;
  const parsed = NonEmptyString1000.fromUnknown(name);
  return { ...row, name: parsed.ok ? parsed.value : null };
};

interface UseContactsDomainParams {
  contacts: ContactsRepository;
  conversations: ConversationsRepository;
  noGroupFilterValue: string;
  pushToast: (message: string) => void;
  reassignContactMessages: (
    fromContactId: string,
    toContactId: string,
  ) => number;
  route: Route;
  t: Translate;
}

export const useContactsDomain = ({
  contacts: contactsRepository,
  conversations,
  noGroupFilterValue,
  pushToast,
  reassignContactMessages,
  route,
  t,
}: UseContactsDomainParams) => {
  const [dedupeContactsIsBusy, setDedupeContactsIsBusy] = React.useState(false);
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);
  const [contactsSearch, setContactsSearch] = React.useState("");

  const contactsSearchInputRef = React.useRef<HTMLInputElement | null>(null);

  const contactRows = useRepositoryRows(contactsRepository);
  const conversationRows = useRepositoryRows(conversations);

  const contacts = React.useMemo(
    () =>
      joinContactChatState(contactRows, conversationRows)
        .map(withNormalizedName)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [contactRows, conversationRows],
  );

  const dedupeContacts = React.useCallback(async () => {
    if (dedupeContactsIsBusy) return;

    setDedupeContactsIsBusy(true);

    const format = (
      template: string,
      vars: Record<string, string | number>,
    ): string => {
      return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(vars[k] ?? ""),
      );
    };

    const normalize = (value: string | null | undefined): string => {
      return (value ?? "").trim().toLowerCase();
    };

    const fieldScore = (value: string | null | undefined): number =>
      normalize(value) ? 1 : 0;

    try {
      const n = contacts.length;
      if (n === 0) {
        pushToast(t("dedupeContactsNone"));
        return;
      }

      const parent = Array.from({ length: n }, (_v, i) => i);
      const find = (i: number): number => {
        let x = i;
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };

      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      };

      const keyToIndex = new Map<string, number>();
      for (let i = 0; i < n; i += 1) {
        const contact = contacts[i];
        const npub = normalize(contact.npub);
        const ln = normalize(contact.lnAddress);
        const keys: string[] = [];
        if (npub) keys.push(`npub:${npub}`);
        if (ln) keys.push(`ln:${ln}`);

        for (const key of keys) {
          const prev = keyToIndex.get(key);
          if (prev == null) keyToIndex.set(key, i);
          else union(i, prev);
        }
      }

      const groups = new Map<number, number[]>();
      for (let i = 0; i < n; i += 1) {
        const root = find(i);
        const arr = groups.get(root);
        if (arr) arr.push(i);
        else groups.set(root, [i]);
      }

      const dupGroups = [...groups.values()].filter((g) => g.length > 1);
      if (dupGroups.length === 0) {
        pushToast(t("dedupeContactsNone"));
        return;
      }

      let removedContacts = 0;
      let movedMessages = 0;

      for (const idxs of dupGroups) {
        const group = idxs.map((i) => contacts[i]);

        let keep = group[0];
        let keepScore =
          fieldScore(keep.name) +
          fieldScore(keep.npub) +
          fieldScore(keep.lnAddress) +
          fieldScore(keep.groupName);
        let keepCreated = Number(keep.createdAt ?? 0);

        for (const contact of group.slice(1)) {
          const score =
            fieldScore(contact.name) +
            fieldScore(contact.npub) +
            fieldScore(contact.lnAddress) +
            fieldScore(contact.groupName);
          const created = Number(contact.createdAt ?? 0);

          if (
            score > keepScore ||
            (score === keepScore && created > keepCreated)
          ) {
            keep = contact;
            keepScore = score;
            keepCreated = created;
          }
        }

        const keepId = keep.id;
        let mergedName = normalize(keep.name) ? keep.name : null;
        let mergedNpub = normalize(keep.npub) ? keep.npub : null;
        let mergedLn = normalize(keep.lnAddress) ? keep.lnAddress : null;
        let mergedGroup = normalize(keep.groupName) ? keep.groupName : null;
        const mergedGroups = normalizeContactGroups(
          group.flatMap((contact) => getContactGroups(contact)),
        );
        const mergedGroupsJson = mergedGroups.length
          ? serializeContactGroups(mergedGroups)
          : null;

        for (const contact of group) {
          if (!mergedName && normalize(contact.name)) mergedName = contact.name;
          if (!mergedNpub && normalize(contact.npub)) mergedNpub = contact.npub;
          if (!mergedLn && normalize(contact.lnAddress)) {
            mergedLn = contact.lnAddress;
          }
          if (!mergedGroup && normalize(contact.groupName)) {
            mergedGroup = contact.groupName;
          }
        }

        const keepNeedsUpdate =
          (keep.name ?? null) !== (mergedName ?? null) ||
          (keep.npub ?? null) !== (mergedNpub ?? null) ||
          (keep.lnAddress ?? null) !== (mergedLn ?? null) ||
          (keep.groupName ?? null) !== (mergedGroup ?? null) ||
          (keep.groupNamesJson ?? "") !== (mergedGroupsJson ?? "");

        if (keepNeedsUpdate) {
          const result = await runWrite(
            contactsRepository.update(
              keepId,
              toContactTextFields({
                name: mergedName,
                npub: mergedNpub,
                lnAddress: mergedLn,
                groupName: mergedGroup,
                groupNamesJson: mergedGroupsJson,
              }),
            ),
          );
          if (!result.ok) throw new Error(result.error);
        }

        for (const contact of group) {
          const duplicateId: ContactId = contact.id;
          if (duplicateId === keepId) continue;

          movedMessages += reassignContactMessages(duplicateId, keepId);
          const removed = await runWrite(
            contactsRepository.remove(duplicateId),
          );
          if (removed.ok) removedContacts += 1;
        }
      }

      pushToast(
        format(t("dedupeContactsResult"), {
          groups: dupGroups.length,
          removed: removedContacts,
          moved: movedMessages,
        }),
      );
    } catch (e) {
      reportAppLog({
        tag: "contacts.dedupeFailed",
        summary: "Contact dedupe failed",
        payload: { error: e },
      });
      pushToast(t("dedupeContactsFailed"));
    } finally {
      setDedupeContactsIsBusy(false);
    }
  }, [
    contacts,
    contactsRepository,
    dedupeContactsIsBusy,
    pushToast,
    reassignContactMessages,
    t,
  ]);

  const { groupCounts, groupNames, ungroupedCount } = React.useMemo(() => {
    const counts = new Map<string, number>();
    let ungrouped = 0;

    for (const contact of contacts) {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      if (Number.isFinite(archivedAtSec) && archivedAtSec > 0) continue;

      const groups = getContactGroups(contact);
      if (groups.length === 0) {
        ungrouped += 1;
        continue;
      }
      for (const group of groups) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }

    const names = Array.from(counts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([name]) => name);

    return {
      groupCounts: counts,
      groupNames: names,
      ungroupedCount: ungrouped,
    };
  }, [contacts]);

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
    contactsSearch,
    contactsSearchData,
    contactsSearchInputRef,
    contactsSearchParts,
    dedupeContacts,
    dedupeContactsIsBusy,
    groupCounts,
    groupNames,
    selectedContact,
    setActiveGroup,
    setContactsSearch,
    ungroupedCount,
  };
};
