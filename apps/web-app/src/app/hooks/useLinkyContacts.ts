import {
  createId,
  NonEmptyString1000,
  type ContactId,
  type ContactsRepository,
} from "@linky-fit/linksync";
import { LINKY_CONTACT_NPUB } from "@linky-fit/supporter";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import { linkyBotNpub } from "../lib/supporter";
import { runWrite } from "../lib/storeWrite";
import type { ContactNameRowLike } from "../types/appTypes";
import type { Translate } from "../../i18n";

type LinkyContactRow = ContactNameRowLike & {
  id: ContactId;
  npub?: string | null | undefined;
};

interface UseLinkyContactsParams<TContact extends LinkyContactRow> {
  contacts: readonly TContact[];
  contactsRepository: Pick<ContactsRepository, "insert" | "update">;
  pushToast: (message: string) => void;
  t: Translate;
}

interface PendingOpen<TContact> {
  npub: string;
  open: (contact: TContact) => void;
}

/**
 * Opens Linky's own identities: the Linky contact for feedback and Linky Bot
 * for donations. A missing one is added first and opened once its row is read
 * back.
 */
export const useLinkyContacts = <TContact extends LinkyContactRow>({
  contacts,
  contactsRepository,
  pushToast,
  t,
}: UseLinkyContactsParams<TContact>) => {
  const pendingRef = React.useRef<PendingOpen<TContact> | null>(null);

  const findByNpub = React.useCallback(
    (npub: string) =>
      contacts.find((contact) => (contact.npub ?? "").trim() === npub),
    [contacts],
  );

  const openByNpub = React.useCallback(
    (pending: PendingOpen<TContact>) => {
      const existing = findByNpub(pending.npub);
      if (existing) {
        pendingRef.current = null;
        pending.open(existing);
        return;
      }

      pendingRef.current = pending;
      void runWrite(
        contactsRepository.insert({
          id: createId<"Contact">(),
          npub: NonEmptyString1000.orThrow(pending.npub),
        }),
      ).then((outcome) => {
        if (outcome.ok) return;
        pendingRef.current = null;
        pushToast(`${t("errorPrefix")}: ${outcome.error}`);
      });
    },
    [contactsRepository, findByNpub, pushToast, t],
  );

  React.useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const existing = findByNpub(pending.npub);
    if (!existing) return;
    pendingRef.current = null;
    pending.open(existing);
  }, [findByNpub]);

  const openFeedbackContact = React.useCallback(
    () =>
      openByNpub({
        npub: LINKY_CONTACT_NPUB,
        open: (contact) => {
          if ((contact.name ?? "") === "Feedback") {
            void runWrite(
              contactsRepository.update(contact.id, { name: null }),
            );
          }
          navigateTo({ route: "chat", id: contact.id });
        },
      }),
    [contactsRepository, openByNpub],
  );

  const openDonate = React.useMemo(() => {
    const npub = linkyBotNpub;
    if (npub === null) return null;
    return () =>
      openByNpub({
        npub,
        open: (contact) =>
          navigateTo({ route: "contactDonate", id: contact.id }),
      });
  }, [openByNpub]);

  return { openDonate, openFeedbackContact };
};
