import type { OwnerId } from "@evolu/common";
import * as Evolu from "@evolu/common";
import React from "react";
import { deriveDefaultProfile } from "../../../derivedProfile";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { ContactId, ContactRow } from "../../../evolu";
import type { Lang, Translate } from "../../../i18n";
import { MAX_CONTACTS_PER_OWNER } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type { ContactRowLike } from "../../types/appTypes";
import { writeContact } from "../../lib/writeContact";

export const contactsLimitMessage = (t: Translate): string =>
  t("contactsLimitReached").replace("{max}", String(MAX_CONTACTS_PER_OWNER));

interface SavedNpubContact {
  contact: ContactRowLike & { id: ContactId };
  created: boolean;
  npub: string;
  ownerId: OwnerId | null;
}
interface UseSaveNpubContactParams {
  contacts: readonly ContactRow[];
  contactsOwnerId: OwnerId | null;
  activeContactsOwnerContactCount: number;
  buildSavedContactName: (bestName: string | null, npub: string) => string;
  unknownNameByNpub: Readonly<Record<string, string | null>>;
  insert: (
    table: "contact",
    payload: { name: string; npub: string },
    options?: { ownerId: OwnerId },
  ) => Evolu.Result<{ id: ContactId }, unknown>;
  lang: Lang;
  setStatus: (status: string) => void;
  t: Translate;
}

export const useSaveNpubContact = ({
  contacts,
  contactsOwnerId,
  activeContactsOwnerContactCount,
  buildSavedContactName,
  unknownNameByNpub,
  insert,
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
      if (existing)
        return {
          contact: existing,
          created: false,
          npub,
          ownerId: existing.ownerId,
        };
      const pendingContact = pending.current.get(npub);
      if (pendingContact) return { ...pendingContact, created: false };
      const pendingCount = [...pending.current.values()].filter(
        (entry) => entry.ownerId === contactsOwnerId,
      ).length;
      if (
        activeContactsOwnerContactCount + pendingCount >=
        MAX_CONTACTS_PER_OWNER
      ) {
        setStatus(contactsLimitMessage(t));
        return null;
      }
      const name = buildSavedContactName(
        unknownNameByNpub[npub] ?? deriveDefaultProfile(npub, lang).name,
        npub,
      );
      const payload = {
        name: Evolu.NonEmptyString1000.orThrow(name),
        npub: Evolu.NonEmptyString1000.orThrow(npub),
      };
      const result = writeContact(insert, payload, contactsOwnerId);
      if (!result.ok) {
        setStatus(`${t("errorPrefix")}: ${String(result.error ?? "")}`);
        return null;
      }
      const saved = {
        contact: { ...payload, id: result.value.id, ownerId: result.ownerId },
        created: true,
        npub,
        ownerId: result.ownerId,
      };
      pending.current.set(npub, saved);
      reportAppLog({
        tag: "contacts.npubSaved",
        summary: "Saved a Nostr contact",
        links: { contact: saved.contact.id },
        payload: { npub },
      });
      return saved;
    },
    [
      activeContactsOwnerContactCount,
      buildSavedContactName,
      contacts,
      contactsOwnerId,
      insert,
      lang,
      setStatus,
      t,
      unknownNameByNpub,
    ],
  );
};
