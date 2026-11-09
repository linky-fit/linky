// Migration bridge; removal gate in app/migrations/AGENTS.md
//
// Hidden listings were kept in this device's localStorage, so other devices
// never saw them. Once the account is hydrated, each one moves onto its
// author's contact row and the stored keys are dropped; a key whose author is
// no contact is dropped with them, since only contacts' listings are listed.

import { parsePubkey } from "@linky-fit/linkstr";
import type { ContactId, ContactRow } from "@linky-fit/linksync";
import { Schema } from "effect";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import {
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
} from "../../utils/storage";

export const LOCAL_HIDDEN_LISTINGS_KEY = "linky.listings.hidden.v1";

export interface HiddenListingMove {
  readonly contactId: ContactId;
  readonly listingId: string;
}

/** The stored keys, `<author pubkey>:<listing id>`; empty once migrated. */
export const readLocalHiddenListings = (): ReadonlyArray<string> =>
  safeLocalStorageGetJson(
    LOCAL_HIDDEN_LISTINGS_KEY,
    Schema.Array(Schema.String),
    [],
  );

export const forgetLocalHiddenListings = (): void =>
  safeLocalStorageRemove(LOCAL_HIDDEN_LISTINGS_KEY);

export const hiddenListingsToMove = (
  keys: ReadonlyArray<string>,
  contacts: ReadonlyArray<ContactRow>,
): ReadonlyArray<HiddenListingMove> => {
  const contactByPubkey = new Map<string, ContactId>();
  for (const contact of contacts) {
    const npub = normalizeNpubIdentifier(contact.npub ?? "");
    const pubkey = npub ? parsePubkey(npub) : null;
    if (pubkey) contactByPubkey.set(pubkey, contact.id);
  }
  return keys.flatMap((key) => {
    const separator = key.indexOf(":");
    const contactId = contactByPubkey.get(key.slice(0, separator));
    const listingId = key.slice(separator + 1);
    return separator < 0 || contactId === undefined || listingId === ""
      ? []
      : [{ contactId, listingId }];
  });
};
