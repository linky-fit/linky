import { parsePubkey, SharedListing, type Listing } from "@linky-fit/linkstr";
import type { Pubkey } from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { isDeletedContact } from "../../utils/contactName";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { peerListingsAtom } from "../state/contacts/listings";
import type { ContactRowLike } from "../types/appTypes";
import type { MessageMentionListing } from "../lib/messageMentions";
import { hiddenListingKey, useHiddenListingKeys } from "../lib/hiddenListings";
import { formatListingPrice, listingOfRecord } from "../lib/listings";
import { currentPubkeyAtom } from "../state/session/session";
import {
  useContacts,
  useNpubMessageContactInfo,
} from "./contacts/useDisplayContacts";
import { useDisplayAmounts, useTranslation } from "./shell";
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
        if (!npub || !pubkey) return [];
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
  }, [contactInfo, contacts, lang, peers]);
};

/** Contacts' listings: what they offer and what they want, and the ones hidden on this device. */
export const usePeerListings = (): {
  offered: ReadonlyArray<PeerListing>;
  wanted: ReadonlyArray<PeerListing>;
  hidden: ReadonlyArray<PeerListing>;
} => {
  const sharing = useSharingContacts();
  const hiddenKeys = useHiddenListingKeys();
  return React.useMemo(() => {
    const entries = sharing.flatMap((contact) =>
      contact.listings.map((listing): PeerListing => ({ contact, listing })),
    );
    const isHidden = ({ contact, listing }: PeerListing) =>
      hiddenKeys.has(hiddenListingKey(contact.pubkey, listing.id));
    const shown = entries.filter((entry) => !isHidden(entry));
    return {
      offered: shown.filter(({ listing }) => listing.side === "offer"),
      wanted: shown.filter(({ listing }) => listing.side === "want"),
      hidden: entries.filter(isHidden),
    };
  }, [hiddenKeys, sharing]);
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
  const { lang } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  return React.useCallback(
    (listing) =>
      `${formatListingPrice(listing.amount, listing.currency, {
        displayCurrency,
        fiatRates,
        lang,
      })} · ${listing.unit}`,
    [displayCurrency, fiatRates, lang],
  );
};
