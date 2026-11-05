import { ContactId, createId, NonEmptyString1000 } from "@linky-fit/linksync";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import { FEEDBACK_CONTACT_NPUB } from "../../utils/constants";
import { runWrite } from "../lib/storeWrite";
import { contactsAtom } from "../state/contacts/readModel";
import type { ContactNameRowLike } from "../types/appTypes";
import { useSaveNpubContact } from "./contacts/useSaveNpubContact";
import {
  useContactSummaries,
  type ContactSummary,
} from "./contacts/useContactSummaries";
import { usePushToast, useTranslation } from "./shell";
import { useNavIntent, useSetNavIntent } from "./shell/navIntents";
import { useContactsRepository } from "./useLinksync";

type FeedbackContactRow = ContactNameRowLike & {
  id: ContactId;
  npub?: string | null | undefined;
};

const findFeedbackContact = <TContact extends FeedbackContactRow>(
  contacts: readonly TContact[],
) =>
  contacts.find(
    (contact) => (contact.npub ?? "").trim() === FEEDBACK_CONTACT_NPUB,
  );

/** Whether the contact is the Linky team, the recipient of feedback and support. */
export const isLinkyContact = (contact: {
  readonly npub?: string | null | undefined;
}): boolean => (contact.npub ?? "").trim() === FEEDBACK_CONTACT_NPUB;

export interface LinkyContact {
  /** The saved row, or a stand-in with the team's npub until `ensure` saves it. */
  readonly contact: ContactSummary;
  /** Saves (or restores) the contact and answers with its id; null while the store is not ready. */
  readonly ensure: () => ContactId | null;
  readonly saved: boolean;
}

/** The Linky team as a contact to pay, e.g. first in the recipient picker. */
export const useLinkyContact = (): LinkyContact => {
  const contacts = useContactSummaries();
  const saveNpubContact = useSaveNpubContact();
  const { t } = useTranslation();
  const existing = React.useMemo(
    () =>
      Array.from(contacts.values()).find(
        (contact) => isLinkyContact(contact) && !contact.deleted,
      ) ?? null,
    [contacts],
  );
  const contact = React.useMemo(
    (): ContactSummary =>
      existing ?? {
        deleted: false,
        id: "",
        lnAddress: null,
        name: t("appTitle"),
        npub: FEEDBACK_CONTACT_NPUB,
      },
    [existing, t],
  );
  const ensure = React.useCallback((): ContactId | null => {
    if (existing) return ContactId.orThrow(existing.id);
    return saveNpubContact(FEEDBACK_CONTACT_NPUB)?.contact.id ?? null;
  }, [existing, saveNpubContact]);
  return { contact, ensure, saved: existing !== null };
};

/** Opens the conversation with the Linky team, saving the contact first if needed. */
export const useOpenFeedbackContact = () => {
  const contacts = useAtomValue(contactsAtom);
  const contactsRepository = useContactsRepository();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const setPending = useSetNavIntent("openFeedbackChat");

  return React.useCallback(() => {
    const existing = findFeedbackContact(contacts);

    if (existing) {
      if ((existing.name ?? "") === "Feedback") {
        void runWrite(contactsRepository.update(existing.id, { name: null }));
      }
      setPending(false);
      navigateTo({ route: "chat", id: existing.id });
      return;
    }

    setPending(true);
    void runWrite(
      contactsRepository.insert({
        id: createId<"Contact">(),
        npub: NonEmptyString1000.orThrow(FEEDBACK_CONTACT_NPUB),
      }),
    ).then((outcome) => {
      if (outcome.ok) return;
      setPending(false);
      pushToast(`${t("errorPrefix")}: ${outcome.error}`);
    });
  }, [contacts, contactsRepository, pushToast, setPending, t]);
};

/** Opens the feedback conversation once its new contact is read back. Mounted once. */
export const useFeedbackContactWatcher = <TContact extends FeedbackContactRow>(
  contacts: readonly TContact[],
): void => {
  const pending = useNavIntent("openFeedbackChat");
  const setPending = useSetNavIntent("openFeedbackChat");
  React.useEffect(() => {
    if (!pending) return;
    const existing = findFeedbackContact(contacts);
    if (!existing) return;
    setPending(false);
    navigateTo({ route: "chat", id: existing.id });
  }, [contacts, pending, setPending]);
};
