import { Schema } from "effect";

/** The `fetch` every network call goes through; `globalThis.fetch` fits. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What the company says about itself in master-signed metadata; never externally verified. */
export const CompanyIdentity = Schema.Struct({
  companyName: Schema.String,
  /** An inline data URL, or an HTTPS URL that is shown only after `fetchVerifiedMedia` against `logoSha256`. */
  logo: Schema.optional(Schema.String),
  logoSha256: Schema.optional(Schema.String),
});
export type CompanyIdentity = typeof CompanyIdentity.Type;

/** The pinned root and the metadata versions this device trusts; persist it per company. */
export const CompanyTrust = Schema.Struct({
  /** The verified `root.json`, exactly as the join origin served it. */
  rootJson: Schema.String,
  timestampVersion: Schema.Int,
  snapshotVersion: Schema.Int,
  /** Versions of the metadata files the trusted snapshot pins, by file name. */
  metaVersions: Schema.Record(Schema.String, Schema.Int),
});
export type CompanyTrust = typeof CompanyTrust.Type;

export const Channel = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
  description: Schema.optional(Schema.String),
});
export type Channel = typeof Channel.Type;

export const PrivateFeedInfo = Schema.Struct({
  /** A label from the authorizing pattern, unrelated to any public channel of the same name. */
  channel: Schema.String,
  displayName: Schema.optional(Schema.String),
  purpose: Schema.optional(Schema.String),
});
export type PrivateFeedInfo = typeof PrivateFeedInfo.Type;

/** A subscribed private feed; `closed` feeds are never fetched again. */
export const PrivateFeedState = Schema.Struct({
  url: Schema.String,
  version: Schema.optional(Schema.Int),
  closed: Schema.Boolean,
});
export type PrivateFeedState = typeof PrivateFeedState.Type;

export const Attachment = Schema.Struct({
  url: Schema.String,
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  sizeInBytes: Schema.optional(Schema.Number),
  /** When present, the bytes are usable only after `fetchVerifiedMedia` matched it. */
  sha256: Schema.optional(Schema.String),
});
export type Attachment = typeof Attachment.Type;

/** One verified item. `contentHtml` is the publisher's HTML, not sanitized. */
export const Announcement = Schema.Struct({
  channel: Schema.String,
  /** Set for private feed items: the feed's capability URL. */
  privateFeedUrl: Schema.optional(Schema.String),
  id: Schema.String,
  title: Schema.String,
  contentHtml: Schema.String,
  /** An inline data URL, or an HTTPS URL pinned by `imageSha256`. */
  image: Schema.optional(Schema.String),
  imageSha256: Schema.optional(Schema.String),
  datePublished: Schema.String,
  dateModified: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  language: Schema.optional(Schema.String),
  attachments: Schema.Array(Attachment),
  /** Channel items only: the signed item file, so a refresh re-verifies it without downloading it again. */
  itemFile: Schema.optional(Schema.String),
});
export type Announcement = typeof Announcement.Type;

export interface JoinRequest {
  /** The join origin to show for confirmation, ASCII (punycode for IDNs). */
  readonly origin: string;
  /** Suggested channels: preselected in the consent summary, never auto-subscribed. */
  readonly channels: ReadonlyArray<string>;
  readonly privateFeeds: ReadonlyArray<string>;
}

export interface PrivateFeedOffer {
  readonly url: string;
  /** Null when no master-signed pattern authorizes the URL: do not subscribe it. */
  readonly info: PrivateFeedInfo | null;
}

export interface CompanySnapshot {
  readonly origin: string;
  readonly trust: CompanyTrust;
  readonly identity: CompanyIdentity;
  readonly catalog: ReadonlyArray<Channel>;
  readonly privateFeeds: ReadonlyArray<PrivateFeedOffer>;
}

export interface CompanySubscription {
  readonly origin: string;
  readonly trust: CompanyTrust;
  /** The identity the user last acknowledged. */
  readonly identity: CompanyIdentity;
  /** Followed public channels. */
  readonly channels: ReadonlyArray<string>;
  readonly privateFeeds: ReadonlyArray<PrivateFeedState>;
}

/** An item that failed this sync; inspector material, not user-facing. */
export interface ItemProblem {
  /** The item's target path, or `<feed url>#<index>` for a private feed item. */
  readonly path: string;
  readonly reason: string;
  /** The download failed transiently and the previously verified copy is still shown. */
  readonly keptCachedCopy: boolean;
}

export interface ChannelSync {
  readonly channel: string;
  /** `unavailable` keeps the channel's cached announcements; `removed` means the company dropped the channel. */
  readonly status: "synced" | "unavailable" | "removed";
  readonly reason?: string;
  readonly problems: ReadonlyArray<ItemProblem>;
}

export interface PrivateFeedSync {
  /** Persist this in place of the feed's previous state. */
  readonly state: PrivateFeedState;
  /**
   * `stale` (past `expires`) and `unavailable` keep the cached announcements
   * and retry; `closed` and `unauthorized` stop polling for good.
   */
  readonly status:
    | "active"
    | "closed"
    | "stale"
    | "unavailable"
    | "unauthorized";
  readonly info?: PrivateFeedInfo;
  readonly expires?: string;
  readonly reason?: string;
  readonly problems: ReadonlyArray<ItemProblem>;
}

export type IdentityChange = "none" | "cosmetic" | "rebrand";

export interface Refreshed {
  readonly _tag: "Refreshed";
  readonly trust: CompanyTrust;
  readonly identity: CompanyIdentity;
  /** `cosmetic` (logo) asks for a one-tap acknowledgement; content stays visible. */
  readonly identityChange: "none" | "cosmetic";
  readonly catalog: ReadonlyArray<Channel>;
  readonly channels: ReadonlyArray<ChannelSync>;
  readonly privateFeeds: ReadonlyArray<PrivateFeedSync>;
  /** Everything to show now, cached ones included, newest first. Replaces the previous list. */
  readonly announcements: ReadonlyArray<Announcement>;
}

/** The company name changed: show nothing until the user pairs again. */
export interface Rebranded {
  readonly _tag: "Rebranded";
  readonly previousIdentity: CompanyIdentity;
  readonly identity: CompanyIdentity;
}

/** A validly signed root does not chain to the pinned one: show nothing, offer only removal. */
export interface Suspended {
  readonly _tag: "Suspended";
  readonly rootVersion: number;
  readonly reason: string;
}

export type RefreshResult = Refreshed | Rebranded | Suspended;
