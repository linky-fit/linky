import { encodeNpub, parsePubkey, type Listing } from "@linky-fit/linkstr";
import type { Pubkey } from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { isDeletedContact } from "../../utils/contactName";
import { formatShortNpub } from "../../utils/formatting";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { peerListingsAtom } from "../state/contacts/listings";
import { profileCacheAtom } from "../state/contacts/profiles";
import type { ContactRowLike } from "../types/appTypes";
import { useContacts } from "./contacts/useDisplayContacts";
import { useTranslation } from "./shell";

/** A saved contact who shares with this identity, with what they share. */
export interface SharingContact {
  readonly contact: ContactRowLike;
  readonly pubkey: Pubkey;
  readonly name: string;
  readonly pictureUrl: string | null;
  readonly cash: "offer" | "want" | null;
  readonly listings: ReadonlyArray<Listing>;
}

export interface PeerListing {
  readonly contact: SharingContact;
  readonly listing: Listing;
}

/**
 * The contacts whose listings document reached this identity, in name
 * order. A document only decodes for contacts who saved the user back, so
 * these are the mutual contacts who share anything.
 */
export const useSharingContacts = (): ReadonlyArray<SharingContact> => {
  const contacts = useContacts();
  const peers = useAtomValue(peerListingsAtom);
  const pictures = useAtomValue(
    profileCacheAtom,
    (cache) => cache.pictureByNpub,
  );
  const { lang } = useTranslation();
  return React.useMemo(() => {
    const collator = new Intl.Collator(lang, {
      usage: "sort",
      numeric: true,
      sensitivity: "variant",
    });
    return contacts
      .flatMap((contact): SharingContact[] => {
        if (isDeletedContact(contact)) return [];
        const npub = normalizeNpubIdentifier(contact.npub ?? "");
        const pubkey = npub ? parsePubkey(npub) : null;
        if (!pubkey) return [];
        const peer = peers[pubkey];
        if (!peer) return [];
        return [
          {
            contact,
            pubkey,
            name:
              (contact.name ?? "").trim() ||
              formatShortNpub(encodeNpub(pubkey)),
            pictureUrl: pictures[encodeNpub(pubkey)] ?? null,
            cash: peer.document.cash,
            listings: peer.document.listings,
          },
        ];
      })
      .sort((left, right) => collator.compare(left.name, right.name));
  }, [contacts, lang, peers, pictures]);
};

/** Contacts' listings: what they offer and what they want. */
export const usePeerListings = (): {
  offered: ReadonlyArray<PeerListing>;
  wanted: ReadonlyArray<PeerListing>;
} => {
  const sharing = useSharingContacts();
  return React.useMemo(() => {
    const entries = sharing.flatMap((contact) =>
      contact.listings.map((listing): PeerListing => ({ contact, listing })),
    );
    return {
      offered: entries.filter(({ listing }) => listing.side === "offer"),
      wanted: entries.filter(({ listing }) => listing.side === "want"),
    };
  }, [sharing]);
};

/** Contacts by cash intent. */
export const useCashContacts = (): {
  offering: ReadonlyArray<SharingContact>;
  wanting: ReadonlyArray<SharingContact>;
} => {
  const sharing = useSharingContacts();
  return React.useMemo(
    () => ({
      offering: sharing.filter(({ cash }) => cash === "offer"),
      wanting: sharing.filter(({ cash }) => cash === "want"),
    }),
    [sharing],
  );
};
