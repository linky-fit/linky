import type { ContactRowLike } from "../app/types/appTypes";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface ContactGroups {
  pinned: readonly ContactRowLike[];
  proxyPayments: readonly ContactRowLike[];
  conversations: readonly ContactRowLike[];
  others: readonly ContactRowLike[];
}

export const isNearbyContact = (
  contact: ContactRowLike,
  nearbyNpubs: ReadonlySet<string>,
): boolean =>
  contact.isUnknownContact !== true &&
  nearbyNpubs.has(normalizeNpubIdentifier(contact.npub ?? "") ?? "");

export const partitionNearbyContacts = (
  groups: ContactGroups,
  nearbyNpubs: ReadonlySet<string>,
) => {
  const seen = new Set<string>();
  const nearby: ContactRowLike[] = [];
  const remaining = (contacts: readonly ContactRowLike[], moveNearby = true) =>
    contacts.filter((contact) => {
      if (contact.id) {
        if (seen.has(contact.id)) return false;
        seen.add(contact.id);
      }
      if (!moveNearby || !isNearbyContact(contact, nearbyNpubs)) return true;
      nearby.push(contact);
      return false;
    });

  return {
    pinned: remaining(groups.pinned, false),
    proxyPayments: remaining(groups.proxyPayments, false),
    conversations: remaining(groups.conversations),
    others: remaining(groups.others),
    nearby,
  };
};
