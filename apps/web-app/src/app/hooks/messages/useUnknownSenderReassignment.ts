import type { ProfileMetadata } from "@linky-fit/linkstr";
import {
  NonEmptyString1000,
  type ContactId,
  type ContactsRepository,
} from "@linky-fit/linksync";
import React from "react";
import { omitSyntheticContactLightningAddress } from "../../../derivedProfile";
import { loadCachedProfile } from "../../../profileCache";
import { getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { findUniqueContactByLightningAddress } from "../../lib/contactIdentity";
import { runWrite } from "../../lib/storeWrite";

interface KnownContact {
  readonly id: ContactId;
  readonly archivedAtSec?: number | null;
  readonly lnAddress?: string | null;
  readonly name?: string | null;
  readonly npub?: string | null;
}

interface UnknownSender {
  readonly id: string;
  readonly npub?: string | null;
}

interface UseUnknownSenderReassignmentParams {
  contacts: ReadonlyArray<KnownContact>;
  contactsRepository: Pick<ContactsRepository, "update">;
  /** Nothing moves before the account is hydrated: the contacts may not have arrived yet. */
  hydrated: boolean;
  reassign: (fromContactId: string, toContactId: string) => number;
  unknownSenders: ReadonlyArray<UnknownSender>;
}

/** Moves an unknown sender's conversation to the contact it turns out to be. */
export const useUnknownSenderReassignment = ({
  contacts,
  contactsRepository,
  hydrated,
  reassign,
  unknownSenders,
}: UseUnknownSenderReassignmentParams): void => {
  React.useEffect(() => {
    if (!hydrated) return;
    // The lightning-address match guesses identity and writes an npub, so it
    // only considers active contacts; a direct npub match also reclaims
    // threads of archived contacts.
    const activeContacts = contacts.filter((contact) => {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      return !Number.isFinite(archivedAtSec) || archivedAtSec <= 0;
    });

    for (const unknownSender of unknownSenders) {
      const unknownContactId = unknownSender.id.trim();
      const unknownNpub = normalizeNpubIdentifier(unknownSender.npub ?? "");
      if (!unknownContactId || !unknownNpub) continue;

      let knownContact = contacts.find((contact) => {
        const knownContactId = contact.id.trim();
        if (!knownContactId || knownContactId === unknownContactId) {
          return false;
        }
        return normalizeNpubIdentifier(contact.npub ?? "") === unknownNpub;
      });

      let matchedByLightningAddress = false;
      let matchedMetadata: ProfileMetadata | null = null;
      if (!knownContact) {
        matchedMetadata = loadCachedProfile(unknownNpub)?.metadata ?? null;
        const profileLightningAddress = matchedMetadata
          ? omitSyntheticContactLightningAddress(
              (matchedMetadata.lud16 ?? "").trim() ||
                (matchedMetadata.lud06 ?? "").trim(),
              unknownNpub,
            )
          : "";
        const lightningContact = findUniqueContactByLightningAddress(
          activeContacts,
          profileLightningAddress,
        );
        if (lightningContact) {
          knownContact = lightningContact;
          matchedByLightningAddress = true;
        }
      }

      const knownContactId = (knownContact?.id ?? "").trim();
      if (!knownContactId) continue;

      if (matchedByLightningAddress && knownContact) {
        const bestName = matchedMetadata
          ? getBestNostrName(matchedMetadata)
          : null;
        const parsedNpub = NonEmptyString1000.fromUnknown(unknownNpub);
        if (!parsedNpub.ok) continue;
        const parsedName = bestName
          ? NonEmptyString1000.fromUnknown(bestName)
          : null;
        const patch = {
          npub: parsedNpub.value,
          ...(!(knownContact.name ?? "").trim() && parsedName?.ok
            ? { name: parsedName.value }
            : {}),
        };
        void runWrite(contactsRepository.update(knownContact.id, patch)).then(
          (outcome) => {
            if (outcome.ok) reassign(unknownContactId, knownContactId);
          },
        );
        continue;
      }

      reassign(unknownContactId, knownContactId);
    }
  }, [contacts, contactsRepository, hydrated, reassign, unknownSenders]);
};
