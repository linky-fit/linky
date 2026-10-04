import { Schema } from "effect";

/** The join URL is not a Keryx join URL; nothing was fetched. */
export class KeryxJoinUrlInvalid extends Schema.TaggedError<KeryxJoinUrlInvalid>()(
  "KeryxJoinUrlInvalid",
  { reason: Schema.String },
) {}

/** The join payload is from a newer protocol version: the app needs an update. */
export class KeryxJoinVersionUnsupported extends Schema.TaggedError<KeryxJoinVersionUnsupported>()(
  "KeryxJoinVersionUnsupported",
  { version: Schema.Number },
) {}

/** A request failed, answered with an error status, redirected off-origin or was too large. */
export class KeryxFetchFailed extends Schema.TaggedError<KeryxFetchFailed>()(
  "KeryxFetchFailed",
  {
    url: Schema.String,
    status: Schema.optional(Schema.Number),
    reason: Schema.String,
  },
) {}

/** Metadata did not verify: malformed, wrongly signed, below threshold, or not matching its pinned hash, length or version. */
export class KeryxMetadataInvalid extends Schema.TaggedError<KeryxMetadataInvalid>()(
  "KeryxMetadataInvalid",
  { role: Schema.String, reason: Schema.String },
) {}

/** Metadata is older than a version this device already trusted. */
export class KeryxRollbackDetected extends Schema.TaggedError<KeryxRollbackDetected>()(
  "KeryxRollbackDetected",
  {
    role: Schema.String,
    trustedVersion: Schema.Number,
    receivedVersion: Schema.Number,
  },
) {}

/** The freshest verifiable metadata has expired: keep the cache and retry later. */
export class KeryxMetadataExpired extends Schema.TaggedError<KeryxMetadataExpired>()(
  "KeryxMetadataExpired",
  { role: Schema.String, expires: Schema.String },
) {}

/** The company publishes in lite mode, which this client does not implement. */
export class KeryxLiteModeUnsupported extends Schema.TaggedError<KeryxLiteModeUnsupported>()(
  "KeryxLiteModeUnsupported",
  {},
) {}

/** Linked media could not be fetched or its bytes do not match the pinned SHA-256. */
export class KeryxMediaUnavailable extends Schema.TaggedError<KeryxMediaUnavailable>()(
  "KeryxMediaUnavailable",
  { url: Schema.String, reason: Schema.String },
) {}

export type KeryxJoinError = KeryxJoinUrlInvalid | KeryxJoinVersionUnsupported;

export type KeryxError =
  | KeryxFetchFailed
  | KeryxMetadataInvalid
  | KeryxRollbackDetected
  | KeryxMetadataExpired
  | KeryxLiteModeUnsupported;
