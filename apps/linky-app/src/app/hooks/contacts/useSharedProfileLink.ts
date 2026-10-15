import type { ContactId } from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { navigateTo } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import { takeAddContactHashLink } from "../../../sharedProfileLink";
import { PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../../utils/storage";
import type { useSaveNpubContact } from "./useSaveNpubContact";

interface UseSharedProfileLinkParams {
  accountHydrated: boolean;
  contacts: readonly { id: ContactId }[];
  contactsRepository: {
    all: Effect.Effect<readonly { id: ContactId; npub: string | null }[]>;
  };
  currentNpub: string | null;
  saveNpubContact: ReturnType<typeof useSaveNpubContact>;
  setChatDraft: (value: string) => void;
  t: Translate;
}

/**
 * Opens a linky.fit profile link (`#add/<npub>`): saves the peer as a contact
 * and opens the conversation with a greeting drafted. A link opened before
 * onboarding waits in storage; every link waits for hydration and then looks
 * the peer up in the stored contacts, so an account finds the contact it
 * already has instead of adding a duplicate.
 */
export const useSharedProfileLink = ({
  accountHydrated,
  contacts,
  contactsRepository,
  currentNpub,
  saveNpubContact,
  setChatDraft,
  t,
}: UseSharedProfileLinkParams) => {
  const [pendingNpub, setPendingNpub] = React.useState(() =>
    safeLocalStorageGet(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY),
  );
  const [openingContactId, setOpeningContactId] =
    React.useState<ContactId | null>(null);

  // An open app gets the link as a hash change, not a fresh load.
  React.useEffect(() => {
    const acceptHashLink = () => {
      const npub = takeAddContactHashLink();
      if (!npub) return;
      safeLocalStorageSet(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY, npub);
      setPendingNpub(npub);
    };
    acceptHashLink();
    window.addEventListener("hashchange", acceptHashLink);
    return () => window.removeEventListener("hashchange", acceptHashLink);
  }, []);

  React.useEffect(() => {
    if (!pendingNpub || !accountHydrated) return;
    safeLocalStorageRemove(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY);
    setPendingNpub(null);

    if (pendingNpub === normalizeNpubIdentifier(currentNpub ?? "")) {
      navigateTo({ route: "profile" });
      return;
    }
    // Rendered contacts arrive a read after hydration, so a fresh load would miss the stored peer.
    void Effect.runPromise(contactsRepository.all).then((storedContacts) => {
      const existing = storedContacts.find(
        (contact) =>
          normalizeNpubIdentifier(contact.npub ?? "") === pendingNpub,
      );
      const saved = existing
        ? { contact: existing, created: false, npub: pendingNpub }
        : saveNpubContact(pendingNpub);
      if (!saved) return;
      if (saved.created) setChatDraft(t("sharedProfileGreeting"));
      reportAppLog({
        tag: "contacts.sharedProfileOpened",
        summary: saved.created
          ? "Opened a shared profile link and saved the contact"
          : "Opened a shared profile link of an existing contact",
        links: { contact: saved.contact.id },
        payload: { npub: saved.npub, created: saved.created },
      });
      setOpeningContactId(saved.contact.id);
    });
  }, [
    accountHydrated,
    contactsRepository,
    currentNpub,
    pendingNpub,
    saveNpubContact,
    setChatDraft,
    t,
  ]);

  React.useEffect(() => {
    if (!openingContactId) return;
    if (!contacts.some((contact) => contact.id === openingContactId)) return;
    setOpeningContactId(null);
    navigateTo({ route: "chat", id: openingContactId });
  }, [contacts, openingContactId]);
};
