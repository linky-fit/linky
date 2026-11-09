// Migration bridge; removal gate in app/migrations/AGENTS.md
//
// Hidden listings were kept in this device's localStorage (26.11.2), then on
// the author's contact row (`hiddenListingIdsJson`, nightly only), where a
// listing whose author is no contact had nowhere to live. Once the account is
// hydrated, both move into the `hiddenListing` table; the stored keys are
// dropped and the contact column cleared.

import { parsePubkey, type Pubkey } from "@linky-fit/linkstr";
import type { ContactId, ContactRow } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import {
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
} from "../../utils/storage";

export const LOCAL_HIDDEN_LISTINGS_KEY = "linky.listings.hidden.v1";

export interface HiddenListingMove {
  readonly author: Pubkey;
  readonly listingId: string;
}

export interface HiddenListingsMigration {
  readonly moves: ReadonlyArray<HiddenListingMove>;
  /** The contacts whose `hiddenListingIdsJson` to clear once the moves are written. */
  readonly contactsToClear: ReadonlyArray<ContactId>;
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

const decodeContactColumn = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

export const hiddenListingsToMove = (
  keys: ReadonlyArray<string>,
  contacts: ReadonlyArray<
    Pick<ContactRow, "id" | "npub" | "hiddenListingIdsJson">
  >,
): HiddenListingsMigration => {
  const moves: Array<HiddenListingMove> = [];
  const add = (author: Pubkey | null, listingId: string) => {
    if (author !== null && listingId !== "") moves.push({ author, listingId });
  };
  for (const key of keys) {
    const separator = key.indexOf(":");
    if (separator > 0)
      add(parsePubkey(key.slice(0, separator)), key.slice(separator + 1));
  }
  const contactsToClear: Array<ContactId> = [];
  for (const contact of contacts) {
    if (contact.hiddenListingIdsJson === null) continue;
    contactsToClear.push(contact.id);
    const npub = normalizeNpubIdentifier(contact.npub ?? "");
    const author = npub ? parsePubkey(npub) : null;
    const ids = Option.getOrElse(
      decodeContactColumn(contact.hiddenListingIdsJson),
      () => [],
    );
    for (const listingId of ids) add(author, listingId);
  }
  return { moves, contactsToClear };
};
