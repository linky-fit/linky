import { parsePubkey, SharedListing, type Listing } from "@linky-fit/linkstr";
import { hiddenListingKey } from "@linky-fit/linksync";
import type { Pubkey } from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { isDeletedContact } from "../../utils/contactName";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { blockListAtom } from "../state/contacts/blockList";
import { peerListingsAtom } from "../state/contacts/listings";
import type { ContactRowLike } from "../types/appTypes";
import type { MessageMentionListing } from "../lib/messageMentions";
import { formatListingPrice, listingOfRecord } from "../lib/listings";
import { peerListingEntries, type ListingSource } from "../lib/listingAudience";
import { currentPubkeyAtom } from "../state/session/session";
import {
  useContacts,
  useNpubMessageContactInfo,
} from "./contacts/useDisplayContacts";
import { useDisplayAmounts, useTranslation } from "./shell";
import { useHiddenListingKeys } from "./useHiddenListings";
import { useListingRecords } from "./useLinksync";

/** A saved contact who shares with this identity, with what they share. */
export interface SharingContact {
  readonly contact: ContactRowLike;
  readonly pubkey: Pubkey;
  readonly name: string;
  readonly pictureUrl: string | null;
  readonly cash: "offer" | "want" | null;
  readonly listings: ReadonlyArray<Listing>;
}

/** The author as the user knows them: a saved contact, with the name and photo shown for them. */
export interface ListingSeller {
  readonly contact: ContactRowLike;
  readonly name: string;
  readonly pictureUrl: string | null;
}

/** Someone else's listing as the lists show it. */
export interface PeerListing {
  readonly author: Pubkey;
  readonly listing: Listing;
  /** Null when the author is not a contact: then neither their name nor photo is shown, only `via`. */
  readonly seller: ListingSeller | null;
  /** The contacts who passed the listing on; empty when the author shares it with the user. */
  readonly via: ReadonlyArray<ListingSource>;
}

/**
 * The contacts whose listings document reached this identity, in name
 * order, leaving out the blocked ones. A document only decodes for contacts
 * who saved the user back, so these are the mutual contacts who share
 * anything.
 */
export const useSharingContacts = (): ReadonlyArray<SharingContact> => {
  const contacts = useContacts();
  const peers = useAtomValue(peerListingsAtom);
  const blockList = useAtomValue(blockListAtom);
  const contactInfo = useNpubMessageContactInfo();
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
        if (!npub || !pubkey || blockList.includes(pubkey)) return [];
        const peer = peers[pubkey];
        const info = peer ? contactInfo(npub) : null;
        if (!peer || !info) return [];
        return [
          {
            contact,
            pubkey,
            name: info.displayName,
            pictureUrl: info.pictureUrl,
            cash: peer.document.cash,
            listings: peer.document.listings,
          },
        ];
      })
      .sort((left, right) => collator.compare(left.name, right.name));
  }, [blockList, contactInfo, contacts, lang, peers]);
};

/** Every listing others share with the user: the contacts' own, then those passed on through them from the contacts' contacts. */
export const useAllPeerListings = (): ReadonlyArray<PeerListing> => {
  const sharing = useSharingContacts();
  const peers = useAtomValue(peerListingsAtom);
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const blockList = useAtomValue(blockListAtom);
  const contacts = useContacts();
  const contactInfo = useNpubMessageContactInfo();
  return React.useMemo(() => {
    const sources = sharing.flatMap((contact): ListingSource[] => {
      const peer = peers[contact.pubkey];
      return peer
        ? [
            {
              pubkey: contact.pubkey,
              name: contact.name,
              pictureUrl: contact.pictureUrl,
              updatedAt: peer.updatedAt,
              document: peer.document,
            },
          ]
        : [];
    });
    const sellers = new Map<string, ListingSeller>();
    for (const contact of contacts) {
      if (isDeletedContact(contact)) continue;
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      const pubkey = npub ? parsePubkey(npub) : null;
      const info = npub ? contactInfo(npub) : null;
      if (!pubkey || !info) continue;
      sellers.set(pubkey, {
        contact,
        name: info.displayName,
        pictureUrl: info.pictureUrl,
      });
    }
    return peerListingEntries(sources, ownPubkey, new Set(blockList)).map(
      (entry): PeerListing => ({
        ...entry,
        seller: sellers.get(entry.author) ?? null,
      }),
    );
  }, [blockList, contactInfo, contacts, ownPubkey, peers, sharing]);
};

/** Others' listings: what they offer and what they want, and the ones the user hid. */
export const usePeerListings = (): {
  offered: ReadonlyArray<PeerListing>;
  wanted: ReadonlyArray<PeerListing>;
  hidden: ReadonlyArray<PeerListing>;
} => {
  const entries = useAllPeerListings();
  const hiddenKeys = useHiddenListingKeys();
  return React.useMemo(() => {
    const isHidden = ({ author, listing }: PeerListing) =>
      hiddenKeys.has(hiddenListingKey(author, listing.id));
    const shown = entries.filter((entry) => !isHidden(entry));
    return {
      offered: shown.filter(({ listing }) => listing.side === "offer"),
      wanted: shown.filter(({ listing }) => listing.side === "want"),
      hidden: entries.filter(isHidden),
    };
  }, [entries, hiddenKeys]);
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

/** The user's own and the sharing contacts' listings, newest first, as the `@` suggestions offer them. */
export const useMentionListings = (): ReadonlyArray<MessageMentionListing> => {
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const records = useListingRecords();
  const sharing = useSharingContacts();
  const peers = useAtomValue(peerListingsAtom);
  const hiddenKeys = useHiddenListingKeys();
  return React.useMemo(() => {
    const dated: Array<MessageMentionListing & { readonly at: number }> = [];
    if (ownPubkey) {
      for (const record of records) {
        const listing = listingOfRecord(record);
        if (listing === null) continue;
        dated.push({
          at: record.createdAtSec,
          authorName: null,
          shared: new SharedListing({ author: ownPubkey, listing }),
        });
      }
    }
    for (const contact of sharing) {
      const at = peers[contact.pubkey]?.updatedAt ?? 0;
      // A document lists oldest first, and the sort below keeps equal times in order.
      for (const listing of [...contact.listings].reverse()) {
        if (hiddenKeys.has(hiddenListingKey(contact.pubkey, listing.id)))
          continue;
        dated.push({
          at,
          authorName: contact.name,
          shared: new SharedListing({ author: contact.pubkey, listing }),
        });
      }
    }
    return dated
      .sort((left, right) => right.at - left.at)
      .map(({ authorName, shared }) => ({ authorName, shared }));
  }, [hiddenKeys, ownPubkey, peers, records, sharing]);
};

/** `90 Kč · per 10 pieces`, priced in the viewer's display unit. */
export const useListingPriceText = (): ((listing: Listing) => string) => {
  const { lang, t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  return React.useCallback(
    (listing) =>
      `${formatListingPrice(listing, { displayCurrency, fiatRates, lang }, t)} · ${listing.unit}`,
    [displayCurrency, fiatRates, lang, t],
  );
};
