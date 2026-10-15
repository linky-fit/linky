import {
  Announcement,
  Channel,
  CompanyIdentity,
  PrivateFeedState,
  type CompanySnapshot,
  type CompanySubscription,
  type RefreshResult,
} from "@linky-fit/keryx";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Schema } from "effect";

/** What this device last learned about a paired company; device-local and re-fetchable. */
export const KeryxCacheEntry = Schema.Struct({
  status: Schema.Literals(["active", "suspended", "rebranded"]),
  /** Newest first, as the last refresh returned them. */
  announcements: Schema.Array(Announcement),
  catalog: Schema.Array(Channel),
  /** Display names of private feeds, by capability URL. */
  feedNames: Schema.Record(Schema.String, Schema.String),
  /** Private feed sync state by capability URL; the synced row holds only the URLs. */
  feedStates: Schema.Record(Schema.String, PrivateFeedState),
  /** A new logo awaiting acknowledgement, or the new identity of a rebrand. */
  pendingIdentity: Schema.optional(CompanyIdentity),
  refreshedAt: Schema.optional(Schema.String),
});
export type KeryxCacheEntry = typeof KeryxCacheEntry.Type;

export const emptyCacheEntry: KeryxCacheEntry = {
  status: "active",
  announcements: [],
  catalog: [],
  feedNames: {},
  feedStates: {},
};

const feedNamesOf = (
  feeds: ReadonlyArray<{
    readonly url: string;
    readonly info?:
      | { readonly displayName?: string | undefined }
      | null
      | undefined;
  }>,
): Record<string, string> =>
  Object.fromEntries(
    feeds.flatMap((feed) =>
      feed.info?.displayName ? [[feed.url, feed.info.displayName]] : [],
    ),
  );

/** The cache a fresh pairing starts from, so the company page names channels before the first refresh. */
export const pairedCacheEntry = (
  snapshot: CompanySnapshot,
): KeryxCacheEntry => ({
  ...emptyCacheEntry,
  catalog: snapshot.catalog,
  feedNames: feedNamesOf(snapshot.privateFeeds),
});

export const nextCacheEntry = (
  previous: KeryxCacheEntry,
  result: RefreshResult,
  now: Date,
): KeryxCacheEntry => {
  const refreshedAt = now.toISOString();
  switch (result._tag) {
    case "Refreshed":
      return {
        status: "active",
        announcements: result.announcements,
        catalog: result.catalog,
        feedNames: {
          ...previous.feedNames,
          ...feedNamesOf(
            result.privateFeeds.map((feed) => ({
              url: feed.state.url,
              info: feed.info,
            })),
          ),
        },
        feedStates: {
          ...previous.feedStates,
          ...Object.fromEntries(
            result.privateFeeds.map((feed) => [feed.state.url, feed.state]),
          ),
        },
        ...(result.identityChange === "cosmetic"
          ? { pendingIdentity: result.identity }
          : {}),
        refreshedAt,
      };
    case "Rebranded":
      return {
        ...previous,
        status: "rebranded",
        announcements: [],
        pendingIdentity: result.identity,
        refreshedAt,
      };
    case "Suspended":
      return {
        ...previous,
        status: "suspended",
        announcements: [],
        refreshedAt,
      };
  }
};

/** The subscription with this device's private feed states; a feed without one starts fresh. */
export const withFeedStates = (
  subscription: CompanySubscription,
  entry: KeryxCacheEntry,
): CompanySubscription => ({
  ...subscription,
  privateFeeds: subscription.privateFeeds.map(
    (feed) => entry.feedStates[feed.url] ?? feed,
  ),
});

/** The announcements to show: none while suspended or rebranded, and only from followed channels. */
export const visibleAnnouncements = (
  entry: KeryxCacheEntry,
  subscription: CompanySubscription,
): ReadonlyArray<Announcement> =>
  entry.status === "active"
    ? entry.announcements.filter(
        (announcement) =>
          announcement.privateFeedUrl !== undefined ||
          subscription.channels.includes(announcement.channel),
      )
    : [];

/** A short stand-in for a capability URL, safe for routes and logs. */
export const privateFeedKey = (url: string): string =>
  `feed-${bytesToHex(sha256(utf8ToBytes(url))).slice(0, 12)}`;

/** Ids are unique per channel or private feed only, so the key carries the source. */
export const announcementKey = (announcement: Announcement): string =>
  `${
    announcement.privateFeedUrl === undefined
      ? announcement.channel
      : privateFeedKey(announcement.privateFeedUrl)
  }/${announcement.id}`;

/** The channel's display name, or the private feed's; falls back to the raw name. */
export const announcementSourceName = (
  entry: KeryxCacheEntry,
  announcement: Announcement,
): string =>
  (announcement.privateFeedUrl === undefined
    ? entry.catalog.find((channel) => channel.name === announcement.channel)
        ?.displayName
    : entry.feedNames[announcement.privateFeedUrl]) ?? announcement.channel;
