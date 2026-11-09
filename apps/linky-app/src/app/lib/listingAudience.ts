import {
  Listing,
  ListingsAudience,
  parsePubkey,
  ListingsDocument,
  ListingsDraft,
  SharedListing,
  type CashIntent,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  hiddenListingIdsOf,
  NonEmptyString1000,
  type ContactRow,
  type ListingRecord,
} from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import type { Translate } from "../../i18n";
import { isDeletedContact } from "../../utils/contactName";
import { getContactGroups } from "../../utils/contactGroups";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
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

/** A group with how many contacts are in it: `Rodina (3)`. */
export const contactGroupLabel = (
  group: string,
  groupCounts: ReadonlyMap<string, number>,
): string => `${group} (${groupCounts.get(group) ?? 0})`;

/** Who sees an own listing, as its row and detail name it. */
export const listingAudienceLabel = (
  audience: ListingAudience | null,
  t: Translate,
  groupCounts: ReadonlyMap<string, number>,
): string =>
  audience === null
    ? t("listingAudienceNobody")
    : audience.kind === "group"
      ? contactGroupLabel(audience.group, groupCounts)
      : t(
          audience.kind === "network"
            ? "listingAudienceNetwork"
            : "listingAudienceContacts",
        );

/** A saved contact who gets a key slot, with the groups they are in and their listings the user hid. */
export interface ListingsRecipient {
  readonly pubkey: Pubkey;
  readonly groups: ReadonlyArray<string>;
  readonly hiddenListingIds: ReadonlyArray<string>;
}

/**
 * The contacts who get a key slot: saved, not blocked, not the user, with a
 * pubkey; with their groups, which decide the group listings they read, and
 * the listings of theirs the user hid, which are never passed on.
 */
export const listingsRecipients = (
  rows: ReadonlyArray<
    Pick<
      ContactRow,
      | "npub"
      | "groupName"
      | "groupNamesJson"
      | "archivedAtSec"
      | "hiddenListingIdsJson"
    >
  >,
  blocked: ReadonlyArray<string>,
  ownPubkey: Pubkey | null,
): ReadonlyArray<ListingsRecipient> => {
  const excluded = new Set<string>(blocked);
  if (ownPubkey) excluded.add(ownPubkey);
  const recipients = new Map<
    Pubkey,
    { groups: Set<string>; hiddenListingIds: Set<string> }
  >();
  for (const row of rows) {
    if (isDeletedContact(row)) continue;
    const npub = normalizeNpubIdentifier(row.npub ?? "");
    const pubkey = npub ? parsePubkey(npub) : null;
    if (!pubkey || excluded.has(pubkey)) continue;
    const recipient = recipients.get(pubkey) ?? {
      groups: new Set<string>(),
      hiddenListingIds: new Set<string>(),
    };
    for (const group of getContactGroups(row)) recipient.groups.add(group);
    for (const id of hiddenListingIdsOf(row))
      recipient.hiddenListingIds.add(id);
    recipients.set(pubkey, recipient);
  }
  return [...recipients.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pubkey, { groups, hiddenListingIds }]) => ({
      pubkey,
      groups: [...groups].sort(),
      hiddenListingIds: [...hiddenListingIds].sort(),
    }));
};

interface ListingsDraftInput {
  readonly records: ReadonlyArray<ListingRecord>;
  readonly cash: CashIntent | null;
  readonly recipients: ReadonlyArray<ListingsRecipient>;
  /** The documents the recipients share with the user, whose `network` listings the user passes on. */
  readonly peerDocuments: Readonly<
    Record<Pubkey, { document: ListingsDocument; updatedAt: number }>
  >;
  /** Whether the user passes the contacts' network listings on at all. */
  readonly passOn: boolean;
}

const byKey =
  <A>(key: (value: A) => string) =>
  (left: A, right: A) =>
    key(left).localeCompare(key(right));

/**
 * The recipients' own network listings the user did not hide, taken in turns
 * from each contact, newest document first and each contact's newest listing
 * first, so a publish that keeps only the first ones keeps some of everyone's.
 */
const passedOnListings = (
  recipients: ReadonlyArray<ListingsRecipient>,
  peerDocuments: ListingsDraftInput["peerDocuments"],
): Array<SharedListing> => {
  const queues = recipients
    .flatMap(({ pubkey, hiddenListingIds }) => {
      const peer = peerDocuments[pubkey];
      return peer ? [{ pubkey, hiddenListingIds, ...peer }] : [];
    })
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.pubkey.localeCompare(right.pubkey),
    )
    .map(({ pubkey, hiddenListingIds, document }) =>
      document.listings
        .filter(
          (listing) =>
            listing.reach === "network" &&
            !hiddenListingIds.includes(listing.id),
        )
        .reverse()
        .map((listing) => new SharedListing({ author: pubkey, listing })),
    );
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  return Array.from({ length: longest }, (_, turn) =>
    queues.flatMap((queue) => queue[turn] ?? []),
  ).flat();
};

/**
 * What to publish: the contacts' and the network's listings for every
 * recipient, the contacts' network listings passed on to them unless the user
 * opted out, and one audience per group with listings for its members only.
 * A group nobody is in publishes its listings to nobody.
 */
export const buildListingsDraft = ({
  records,
  cash,
  recipients,
  peerDocuments,
  passOn,
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
      everyone.push(new Listing({ ...listing, reach: "network" }));
    } else {
      everyone.push(listing);
    }
  }
  const passedOn = passOn ? passedOnListings(recipients, peerDocuments) : [];
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
