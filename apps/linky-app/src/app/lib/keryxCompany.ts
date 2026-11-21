import {
  CompanyIdentity,
  CompanyTrust,
  type CompanySnapshot,
  type CompanySubscription,
  type Refreshed,
} from "@linky-fit/keryx";
import {
  keryxSubscriptionIdFor,
  type KeryxSubscriptionId,
  type KeryxSubscriptionInsert,
  type KeryxSubscriptionPatch,
  type KeryxSubscriptionRecord,
} from "@linky-fit/linksync";
import { Option, Schema } from "effect";

export type { KeryxSubscriptionPatch };

const TrustJson = Schema.fromJsonString(CompanyTrust);
const IdentityJson = Schema.fromJsonString(CompanyIdentity);
const ChannelsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const PrivateFeedsJson = Schema.fromJsonString(Schema.Array(Schema.String));

const StoredSubscription = Schema.Struct({
  trustJson: TrustJson,
  identityJson: IdentityJson,
  channelsJson: ChannelsJson,
  privateFeedsJson: Schema.NullOr(PrivateFeedsJson),
});
const decodeStored = Schema.decodeUnknownOption(StoredSubscription);

/**
 * A paired company as this device reads it from its synced row. Its private
 * feeds start fresh; `withFeedStates` adds this device's sync state.
 */
export interface KeryxCompany {
  readonly id: KeryxSubscriptionId;
  readonly record: KeryxSubscriptionRecord;
  readonly subscription: CompanySubscription;
}

/** Null for a row whose JSON does not decode, e.g. one written by a newer app version. */
export const readKeryxCompany = (
  record: KeryxSubscriptionRecord,
): KeryxCompany | null =>
  Option.getOrNull(
    Option.map(decodeStored(record), (stored) => ({
      id: record.id,
      record,
      subscription: {
        origin: record.origin,
        trust: stored.trustJson,
        identity: stored.identityJson,
        channels: stored.channelsJson,
        privateFeeds: (stored.privateFeedsJson ?? []).map((url) => ({
          url,
          closed: false,
        })),
      },
    })),
  );

const json = <A>(schema: Schema.Codec<A, string>, value: A): string =>
  Schema.encodeSync(schema)(value);

export const channelsColumn = (channels: ReadonlyArray<string>): string =>
  json(ChannelsJson, channels);

export const identityColumn = (identity: CompanyIdentity): string =>
  json(IdentityJson, identity);

const privateFeedsColumn = (urls: ReadonlyArray<string>): string =>
  json(PrivateFeedsJson, urls);

/** The private feed URLs of a pairing: only those a master-signed pattern authorizes. */
export const authorizedPrivateFeeds = (
  snapshot: CompanySnapshot,
): ReadonlyArray<string> =>
  snapshot.privateFeeds.flatMap((feed) =>
    feed.info === null ? [] : [feed.url],
  );

/** The row a pairing inserts; it overwrites an earlier pairing of the origin, private feeds included. */
export const keryxSubscriptionInsert = (
  snapshot: CompanySnapshot,
  channels: ReadonlyArray<string>,
  pairedAtSec: number,
): KeryxSubscriptionInsert => {
  const privateFeeds = authorizedPrivateFeeds(snapshot);
  return {
    id: keryxSubscriptionIdFor(snapshot.origin),
    origin: snapshot.origin,
    trustJson: json(TrustJson, snapshot.trust),
    identityJson: identityColumn(snapshot.identity),
    channelsJson: channelsColumn(channels),
    pairedAtSec,
    // An explicit null, unlike other inserts: re-pairing clears the feeds of the pairing it overwrites.
    privateFeedsJson:
      privateFeeds.length > 0 ? privateFeedsColumn(privateFeeds) : null,
  };
};

/** Private feeds from another scan of the join URL, appended; null when all are subscribed already. */
export const mergePrivateFeeds = (
  company: KeryxCompany,
  urls: ReadonlyArray<string>,
): KeryxSubscriptionPatch | null => {
  const known = company.subscription.privateFeeds.map((feed) => feed.url);
  const added = urls.filter((url) => !known.includes(url));
  return added.length === 0
    ? null
    : { privateFeedsJson: privateFeedsColumn([...known, ...added]) };
};

/** The trust a refresh verified; null when the row already holds it. */
export const trustWriteback = (
  company: KeryxCompany,
  refreshed: Refreshed,
): KeryxSubscriptionPatch | null => {
  const trustJson = json(TrustJson, refreshed.trust);
  return trustJson === company.record.trustJson ? null : { trustJson };
};
