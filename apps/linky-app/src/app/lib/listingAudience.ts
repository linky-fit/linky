import {
  Listing,
  ListingsAudience,
  ListingsDocument,
  ListingsDraft,
  SharedListing,
  type CashIntent,
  type Pubkey,
} from "@linky-fit/linkstr";
import { NonEmptyString1000, type ListingRecord } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import type { Translate } from "../../i18n";
import { listingOfRecord } from "./listings";

/** Who sees a listing: the contacts, their contacts too, or one contact group only. */
export type ListingAudience =
  | { readonly kind: "contacts" }
  | { readonly kind: "network" }
  | { readonly kind: "group"; readonly group: string };

export const LISTING_AUDIENCE_KINDS = [
  "network",
  "contacts",
  "group",
] as const satisfies ReadonlyArray<ListingAudience["kind"]>;

const StoredAudience = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("network") }),
    Schema.Struct({
      kind: Schema.Literal("group"),
      group: Schema.Trimmed.check(Schema.isNonEmpty()),
    }),
  ]),
);
const decodeStoredAudience = Schema.decodeUnknownOption(StoredAudience);
const encodeStoredAudience = Schema.encodeSync(StoredAudience);

/** The audience of a stored row; null when the column holds something unknown, which publishes the listing to nobody. */
export const listingAudienceOfRecord = (
  record: Pick<ListingRecord, "audience">,
): ListingAudience | null =>
  record.audience === null
    ? { kind: "contacts" }
    : Option.getOrNull(decodeStoredAudience(record.audience));

/** The `audience` column for `audience`: null for the contacts, the default. */
export const listingAudienceColumn = (
  audience: ListingAudience,
): NonEmptyString1000 | null =>
  audience.kind === "contacts"
    ? null
    : NonEmptyString1000.orThrow(encodeStoredAudience(audience));

/** Who sees an own listing, as its row and detail name it. */
export const listingAudienceLabel = (
  audience: ListingAudience | null,
  t: Translate,
): string =>
  audience === null
    ? t("listingAudienceNobody")
    : audience.kind === "group"
      ? audience.group
      : t(
          audience.kind === "network"
            ? "listingAudienceNetwork"
            : "listingAudienceContacts",
        );

/** A saved contact who gets a key slot, with the groups they are in. */
export interface ListingsRecipient {
  readonly pubkey: Pubkey;
  readonly groups: ReadonlyArray<string>;
}

interface ListingsDraftInput {
  readonly records: ReadonlyArray<ListingRecord>;
  readonly cash: CashIntent | null;
  readonly recipients: ReadonlyArray<ListingsRecipient>;
  /** The documents the recipients share with the user, whose `network` listings the user passes on. */
  readonly peerDocuments: Readonly<
    Record<Pubkey, { document: ListingsDocument }>
  >;
}

const byKey =
  <A>(key: (value: A) => string) =>
  (left: A, right: A) =>
    key(left).localeCompare(key(right));

/**
 * What to publish: the contacts' and the network's listings for every
 * recipient, the contacts' network listings passed on to them, and one
 * audience per group with listings for its members only. A group nobody is in
 * publishes its listings to nobody.
 */
export const buildListingsDraft = ({
  records,
  cash,
  recipients,
  peerDocuments,
}: ListingsDraftInput): ListingsDraft => {
  const everyone: Array<Listing> = [];
  const byGroup = new Map<string, Array<Listing>>();
  for (const record of [...records].sort(
    (left, right) => left.createdAtSec - right.createdAtSec,
  )) {
    const listing = listingOfRecord(record);
    const audience = listingAudienceOfRecord(record);
    if (listing === null || audience === null) continue;
    if (audience.kind === "group") {
      byGroup.set(audience.group, [
        ...(byGroup.get(audience.group) ?? []),
        listing,
      ]);
    } else if (audience.kind === "network") {
      everyone.push(new Listing({ ...listing, audience: "network" }));
    } else {
      everyone.push(listing);
    }
  }
  const passedOn = recipients
    .flatMap(({ pubkey }) =>
      (peerDocuments[pubkey]?.document.listings ?? []).flatMap((listing) =>
        listing.audience === "network"
          ? [new SharedListing({ author: pubkey, listing })]
          : [],
      ),
    )
    .sort(byKey((shared) => `${shared.author}:${shared.listing.id}`));
  return new ListingsDraft({
    document: new ListingsDocument({
      cash,
      listings: everyone,
      ...(passedOn.length > 0 ? { passedOn } : {}),
    }),
    recipients: recipients.map(({ pubkey }) => pubkey),
    audiences: [...byGroup.entries()]
      .sort(byKey(([group]) => group))
      .flatMap(([group, listings]) => {
        const members = recipients
          .filter(({ groups }) => groups.includes(group))
          .map(({ pubkey }) => pubkey);
        return members.length === 0
          ? []
          : [new ListingsAudience({ listings, recipients: members })];
      }),
  });
};

/** A contact the listings reached the user through. */
export interface ListingSource {
  readonly pubkey: Pubkey;
  readonly name: string;
  readonly pictureUrl: string | null;
  readonly updatedAt: number;
  readonly document: ListingsDocument;
}

/** One listing someone else shares, as the user sees it. */
export interface PeerListingEntry {
  readonly author: Pubkey;
  readonly listing: Listing;
  /** The contacts who passed it on, newest document first; empty when the author shares it directly. */
  readonly via: ReadonlyArray<ListingSource>;
}

/**
 * The listings the sources share directly, then those they pass on that the
 * user does not get from the author: one entry per author and listing, in the
 * version of the newest document, with every contact who passed it on. The
 * user's own listings and blocked authors are left out.
 */
export const peerListingEntries = (
  sources: ReadonlyArray<ListingSource>,
  ownPubkey: Pubkey | null,
  blocked: ReadonlySet<string>,
): ReadonlyArray<PeerListingEntry> => {
  const direct: Array<PeerListingEntry> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const listing of source.document.listings) {
      seen.add(`${source.pubkey}:${listing.id}`);
      direct.push({ author: source.pubkey, listing, via: [] });
    }
  }
  const passed = new Map<
    string,
    { listing: Listing; author: Pubkey; via: Array<ListingSource> }
  >();
  const newestFirst = [...sources].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  for (const source of newestFirst) {
    for (const { author, listing } of source.document.passedOn ?? []) {
      const key = `${author}:${listing.id}`;
      if (author === ownPubkey || blocked.has(author) || seen.has(key)) {
        continue;
      }
      const entry = passed.get(key);
      if (entry) {
        if (!entry.via.includes(source)) entry.via.push(source);
      } else {
        passed.set(key, { author, listing, via: [source] });
      }
    }
  }
  return [...direct, ...passed.values()];
};
