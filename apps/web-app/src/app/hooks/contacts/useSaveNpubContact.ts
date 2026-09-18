import {
  createId,
  NonEmptyString1000,
  type ContactId,
  type ContactsRepository,
} from "@linky/linksync";
import React from "react";
import { deriveDefaultProfile } from "../../../derivedProfile";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Lang, Translate } from "../../../i18n";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { runWrite } from "../../lib/storeWrite";
import type { ContactRowLike } from "../../types/appTypes";

interface SavedNpubContact {
  contact: ContactRowLike & { id: ContactId };
  created: boolean;
  npub: string;
}
interface UseSaveNpubContactParams {
  contacts: readonly (ContactRowLike & { id: ContactId })[];
  contactsRepository: Pick<ContactsRepository, "insert">;
  buildSavedContactName: (bestName: string | null, npub: string) => string;
  unknownNameByNpub: Readonly<Record<string, string | null>>;
  lang: Lang;
  setStatus: (status: string) => void;
  t: Translate;
}

/**
 * Saves a Nostr peer as a contact and answers synchronously with the new id:
 * the row is written in the background and the pending entry keeps a second
 * save of the same npub from inserting twice before the row is read back.
 */
export const useSaveNpubContact = ({
  contacts,
  contactsRepository,
  buildSavedContactName,
  unknownNameByNpub,
  lang,
  setStatus,
  t,
}: UseSaveNpubContactParams) => {
  const pending = React.useRef(new Map<string, SavedNpubContact>());
  React.useEffect(() => {
    for (const contact of contacts) {
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      if (npub) pending.current.delete(npub);
    }
  }, [contacts]);
  return React.useCallback(
    (rawNpub: string): SavedNpubContact | null => {
      const npub = normalizeNpubIdentifier(rawNpub);
      if (!npub) return null;
      const existing = contacts.find(
        (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
      );
      if (existing) return { contact: existing, created: false, npub };
      const pendingContact = pending.current.get(npub);
      if (pendingContact) return { ...pendingContact, created: false };
      const name = buildSavedContactName(
        unknownNameByNpub[npub] ?? deriveDefaultProfile(npub, lang).name,
        npub,
      );
      const row = {
        id: createId<"Contact">(),
        name: NonEmptyString1000.orThrow(name),
        npub: NonEmptyString1000.orThrow(npub),
      };
      const saved = { contact: row, created: true, npub };
      pending.current.set(npub, saved);
      void runWrite(contactsRepository.insert(row)).then((outcome) => {
        if (outcome.ok) return;
        pending.current.delete(npub);
        setStatus(`${t("errorPrefix")}: ${outcome.error}`);
      });
      reportAppLog({
        tag: "contacts.npubSaved",
        summary: "Saved a Nostr contact",
        links: { contact: row.id },
        payload: { npub },
      });
      return saved;
    },
    [
      buildSavedContactName,
      contacts,
      contactsRepository,
      lang,
      setStatus,
      t,
      unknownNameByNpub,
    ],
  );
};
