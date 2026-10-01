import { Schema } from "effect";
import { UnixSeconds } from "../domain/primitives";

/**
 * Kind-0 metadata, camelCase on this side of the boundary; the codec maps
 * `displayName` to the wire's `display_name`.
 */
export class ProfileMetadata extends Schema.Class<ProfileMetadata>(
  "ProfileMetadata",
)({
  name: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  picture: Schema.optional(Schema.String),
  lud16: Schema.optional(Schema.String),
  lud06: Schema.optional(Schema.String),
  nip05: Schema.optional(Schema.String),
  about: Schema.optional(Schema.String),
  /**
   * Content fields linkstr does not model (`website`, `banner`, `bot`, …),
   * raw as decoded, so a republish built from a decoded profile keeps them.
   */
  extraFields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class StatusDraft extends Schema.Class<StatusDraft>("StatusDraft")({
  /** Opaque to linkstr; Linky's status conventions live app-side. */
  content: Schema.String,
  expiresAt: Schema.optional(UnixSeconds),
}) {}
