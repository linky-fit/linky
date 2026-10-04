import { Schema } from "effect";

export const CHANNEL_NAME = /^[a-z0-9_-]+$/;

const isRfc3339 = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
    value,
  ) && !Number.isNaN(Date.parse(value));

export const Rfc3339 = Schema.String.pipe(Schema.filter(isRfc3339));
const Version = Schema.Int.pipe(Schema.positive());
const Threshold = Schema.Int.pipe(Schema.positive());
const RawKeys = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const JsonObject = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const Envelope = Schema.Struct({
  signed: JsonObject,
  signatures: Schema.Array(
    Schema.Struct({ keyid: Schema.String, sig: Schema.String }),
  ),
});

export const RoleKeys = Schema.Struct({
  keyids: Schema.Array(Schema.String),
  threshold: Threshold,
});

const Common = { version: Version, expires: Rfc3339 };

export const RootSigned = Schema.Struct({
  _type: Schema.Literal("root"),
  ...Common,
  consistent_snapshot: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  keys: RawKeys,
  roles: Schema.Struct({
    root: RoleKeys,
    targets: RoleKeys,
    snapshot: RoleKeys,
    timestamp: RoleKeys,
  }),
  custom: Schema.Struct({
    repo_base: Schema.String,
    mode: Schema.optionalWith(Schema.String, { default: () => "full" }),
  }),
});
export type RootSigned = typeof RootSigned.Type;

export const MetaFile = Schema.Struct({
  version: Version,
  length: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  hashes: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
});
export type MetaFile = typeof MetaFile.Type;

export const TimestampSigned = Schema.Struct({
  _type: Schema.Literal("timestamp"),
  ...Common,
  meta: Schema.Struct({ "snapshot.json": MetaFile }),
});

export const SnapshotSigned = Schema.Struct({
  _type: Schema.Literal("snapshot"),
  ...Common,
  meta: Schema.Record({ key: Schema.String, value: MetaFile }),
});
export type SnapshotSigned = typeof SnapshotSigned.Type;

export const TargetFile = Schema.Struct({
  length: Schema.Int.pipe(Schema.nonNegative()),
  hashes: Schema.Struct({ sha256: Schema.String }),
});
export type TargetFile = typeof TargetFile.Type;

export const DelegatedRole = Schema.Struct({
  name: Schema.String,
  ...RoleKeys.fields,
  paths: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
export type DelegatedRole = typeof DelegatedRole.Type;

export const TargetsSigned = Schema.Struct({
  _type: Schema.Literal("targets"),
  ...Common,
  targets: Schema.Record({ key: Schema.String, value: TargetFile }),
  delegations: Schema.optionalWith(
    Schema.Struct({ keys: RawKeys, roles: Schema.Array(DelegatedRole) }),
    { default: () => ({ keys: {}, roles: [] }) },
  ),
  custom: Schema.optional(JsonObject),
});
export type TargetsSigned = typeof TargetsSigned.Type;

export const TargetsCustom = Schema.Struct({
  company_name: Schema.NonEmptyString,
  logo: Schema.optional(Schema.String),
  logo_sha256: Schema.optional(Schema.String),
  channels: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  private_feed_patterns: Schema.optional(Schema.Array(Schema.Unknown)),
});

export const ChannelDisplay = Schema.Struct({
  display_name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

export const PrivateFeedPattern = Schema.Struct({
  channel: Schema.String,
  pattern: Schema.String,
  keys: RawKeys,
  ...RoleKeys.fields,
  display_name: Schema.optional(Schema.String),
  purpose: Schema.optional(Schema.String),
});

const ItemSignatures = Schema.Array(
  Schema.Struct({ keyid: Schema.String, sig: Schema.String }),
);

export const ItemFields = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(CHANNEL_NAME)),
  title: Schema.String,
  content_html: Schema.String,
  image: Schema.optional(Schema.String),
  image_sha256: Schema.optional(Schema.String),
  date_published: Rfc3339,
  date_modified: Schema.optional(Rfc3339),
  tags: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  language: Schema.optional(Schema.String),
  attachments: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        url: Schema.String,
        name: Schema.optional(Schema.String),
        mime_type: Schema.optional(Schema.String),
        size_in_bytes: Schema.optional(Schema.Number),
        sha256: Schema.optional(Schema.String),
      }),
    ),
    { default: () => [] },
  ),
});
export type ItemFields = typeof ItemFields.Type;

export const SignedItem = Schema.Struct({
  ...ItemFields.fields,
  sig: ItemSignatures,
});

export const PrivateFeedDocument = Schema.Struct({
  v: Schema.Literal(1),
  channel: Schema.String,
  url: Schema.String,
  version: Version,
  expires: Rfc3339,
  expired: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  items: Schema.Array(Schema.Unknown),
  sig: ItemSignatures,
});

export const JoinPayload = Schema.Struct({
  v: Schema.Literal(1),
  channels: Schema.optionalWith(
    Schema.Array(Schema.String.pipe(Schema.pattern(CHANNEL_NAME))),
    { default: () => [] },
  ),
  private_feeds: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
