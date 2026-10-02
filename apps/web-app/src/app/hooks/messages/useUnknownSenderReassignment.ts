import type { ContactId } from "@linky-fit/linksync";
import React from "react";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";

interface KnownContact {
  readonly id: ContactId;
  readonly npub?: string | null;
}

interface UnknownSender {
  readonly id: string;
  readonly npub?: string | null;
}

interface UseUnknownSenderReassignmentParams {
  contacts: ReadonlyArray<KnownContact>;
  /** Nothing moves before the account is hydrated: the contacts may not have arrived yet. */
  hydrated: boolean;
  reassign: (fromContactId: string, toContactId: string) => number;
  unknownSenders: ReadonlyArray<UnknownSender>;
}

/** Moves an unknown sender's conversation to the contact with the same npub. */
export const useUnknownSenderReassignment = ({
  contacts,
  hydrated,
  reassign,
  unknownSenders,
}: UseUnknownSenderReassignmentParams): void => {
  React.useEffect(() => {
    if (!hydrated) return;

    for (const unknownSender of unknownSenders) {
      const unknownContactId = unknownSender.id.trim();
      const unknownNpub = normalizeNpubIdentifier(unknownSender.npub ?? "");
      if (!unknownContactId || !unknownNpub) continue;

      const knownContact = contacts.find((contact) => {
        const knownContactId = contact.id.trim();
        if (!knownContactId || knownContactId === unknownContactId) {
          return false;
        }
        return normalizeNpubIdentifier(contact.npub ?? "") === unknownNpub;
      });
      if (knownContact) reassign(unknownContactId, knownContact.id);
    }
  }, [contacts, hydrated, reassign, unknownSenders]);
};
