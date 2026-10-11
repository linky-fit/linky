import type { ContactId } from "@linky-fit/linksync";
import { RegistryContext, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import {
  getContactGroups,
  normalizeContactGroups,
  serializeContactGroups,
} from "../../../utils/contactGroups";
import { toContactTextFields } from "../../lib/contactFields";
import { runWrite } from "../../lib/storeWrite";
import { dedupeContactsBusyAtom } from "../../state/contacts/contactForm";
import { contactsAtom } from "../../state/contacts/readModel";
import { useMessagesCommands } from "../messages/useMessagesCommands";
import { usePushToast, useTranslation } from "../shell";
import { useContactsRepository } from "../useLinksync";

/** Merges contacts saved twice under one npub, moving their messages to the one kept. */
export const useDedupeContacts = () => {
  const registry = React.useContext(RegistryContext);
  const contacts = useAtomValue(contactsAtom);
  const contactsRepository = useContactsRepository();
  const messagesCommands = useMessagesCommands();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const reassignContactMessages = React.useCallback(
    (fromContactId: string, toContactId: string): Promise<number> =>
      messagesCommands?.reassignContactMessages(fromContactId, toContactId) ??
      Promise.resolve(0),
    [messagesCommands],
  );

  const dedupeContacts = React.useCallback(async () => {
    if (registry.get(dedupeContactsBusyAtom)) return;

    registry.set(dedupeContactsBusyAtom, true);

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
      if (contacts.length === 0) {
        pushToast(t("dedupeContactsNone"));
        return;
      }

      const contactsByNpub = new Map<string, (typeof contacts)[number][]>();
      for (const contact of contacts) {
        const npub = normalize(contact.npub);
        if (!npub) continue;
        contactsByNpub.set(npub, [
          ...(contactsByNpub.get(npub) ?? []),
          contact,
        ]);
      }

      const dupGroups = [...contactsByNpub.values()].filter(
        (group) => group.length > 1,
      );
      if (dupGroups.length === 0) {
        pushToast(t("dedupeContactsNone"));
        return;
      }

      let removedContacts = 0;
      let movedMessages = 0;

      for (const group of dupGroups) {
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

          movedMessages += await reassignContactMessages(duplicateId, keepId);
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
      registry.set(dedupeContactsBusyAtom, false);
    }
  }, [
    contacts,
    contactsRepository,
    pushToast,
    reassignContactMessages,
    registry,
    t,
  ]);

  return {
    dedupeContacts,
    dedupeContactsIsBusy: useAtomValue(dedupeContactsBusyAtom),
  };
};
