import {
  createId,
  NonEmptyString1000,
  type ContactId,
  type ContactsRepository,
} from "@linky/linksync";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import { FEEDBACK_CONTACT_NPUB } from "../../utils/constants";
import { runWrite } from "../lib/storeWrite";
import type { ContactNameRowLike } from "../types/appTypes";
import type { Translate } from "../../i18n";

type FeedbackContactRow = ContactNameRowLike & {
  id: ContactId;
  npub?: string | null | undefined;
};

interface UseFeedbackContactParams<TContact extends FeedbackContactRow> {
  contacts: readonly TContact[];
  contactsRepository: Pick<ContactsRepository, "insert" | "update">;
  pushToast: (message: string) => void;
  t: Translate;
}

export const useFeedbackContact = <TContact extends FeedbackContactRow>({
  contacts,
  contactsRepository,
  pushToast,
  t,
}: UseFeedbackContactParams<TContact>) => {
  const openFeedbackContactPendingRef = React.useRef(false);

  const openFeedbackContact = React.useCallback(() => {
    const targetNpub = FEEDBACK_CONTACT_NPUB;
    const existing = contacts.find(
      (contact) => (contact.npub ?? "").trim() === targetNpub,
    );

    if (existing) {
      if ((existing.name ?? "") === "Feedback") {
        void runWrite(contactsRepository.update(existing.id, { name: null }));
      }
      openFeedbackContactPendingRef.current = false;
      navigateTo({ route: "chat", id: existing.id });
      return;
    }

    openFeedbackContactPendingRef.current = true;
    void runWrite(
      contactsRepository.insert({
        id: createId<"Contact">(),
        npub: NonEmptyString1000.orThrow(targetNpub),
      }),
    ).then((outcome) => {
      if (outcome.ok) return;
      openFeedbackContactPendingRef.current = false;
      pushToast(`${t("errorPrefix")}: ${outcome.error}`);
    });
  }, [contacts, contactsRepository, pushToast, t]);

  React.useEffect(() => {
    if (!openFeedbackContactPendingRef.current) return;

    const targetNpub = FEEDBACK_CONTACT_NPUB;
    const existing = contacts.find(
      (contact) => (contact.npub ?? "").trim() === targetNpub,
    );
    if (!existing) return;

    openFeedbackContactPendingRef.current = false;
    navigateTo({ route: "chat", id: existing.id });
  }, [contacts]);

  return {
    openFeedbackContact,
  };
};
