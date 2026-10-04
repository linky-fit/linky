import { decodeNpub } from "@linky-fit/linkstr";
import { createContactNameFormatter } from "../../../utils/contactName";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { trimString } from "../../../utils/validation";
import type { ContactNameRowLike } from "../../types/appTypes";
import type { InboxContact } from "./inboxNotifications";

export type InboxContactRowLike = ContactNameRowLike & {
  npub?: string | null | undefined;
  nameSetByUser?: number | null | undefined;
};

const isArchived = (contact: InboxContactRowLike): boolean =>
  (contact.archivedAtSec ?? 0) > 0;

// Row order follows the physical createdAt, which a shard move resets, so
// duplicates of one npub are ranked by archive state and id instead.
const byRoutingPreference = (
  a: InboxContactRowLike,
  b: InboxContactRowLike,
): number => {
  const archivedDiff = Number(isArchived(a)) - Number(isArchived(b));
  if (archivedDiff !== 0) return archivedDiff;
  const aId = trimString(a.id);
  const bId = trimString(b.id);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
};

/**
 * Maps a sender pubkey to the contact its messages land on. Archived contacts
 * stay in the index: when no active contact shares their npub, their incoming
 * messages land on them, which then restores them from the archive.
 */
export const buildContactIndex = (
  contacts: readonly InboxContactRowLike[],
): Map<string, InboxContact> => {
  const contactByPubkey = new Map<string, InboxContact>();
  const formatName = createContactNameFormatter(contacts);
  for (const contact of [...contacts].sort(byRoutingPreference)) {
    const npub = normalizeNpubIdentifier(contact.npub ?? "");
    if (!npub) continue;
    const pubkey = decodeNpub(npub);
    const id = trimString(contact.id);
    if (!pubkey || !id || contactByPubkey.has(pubkey)) continue;
    contactByPubkey.set(pubkey, {
      id,
      name: formatName(contact) || null,
      npub,
    });
  }
  return contactByPubkey;
};
