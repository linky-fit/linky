import { Schema } from "effect";
import { EventId, Pubkey, UnixSeconds } from "../domain/primitives";
import { ProfileMetadata } from "./domain";

/**
 * Facts emitted by `ProfileWatch` (and returned by one-shot fetches). Linkstr
 * persists nothing: consumers compare `updatedAt` against their own cache.
 */

export class ProfileUpdated extends Schema.TaggedClass<ProfileUpdated>()(
  "ProfileUpdated",
  {
    pubkey: Pubkey,
    metadata: ProfileMetadata,
    updatedAt: UnixSeconds,
  },
) {}

export class StatusUpdated extends Schema.TaggedClass<StatusUpdated>()(
  "StatusUpdated",
  {
    pubkey: Pubkey,
    /** Opaque status text; empty string means the status was cleared. */
    content: Schema.String,
    expiresAt: Schema.NullOr(UnixSeconds),
    updatedAt: UnixSeconds,
  },
) {}

export const ProfileWatchEvent = Schema.Union([ProfileUpdated, StatusUpdated]);
export type ProfileWatchEvent = typeof ProfileWatchEvent.Type;

export const ProfileDropReason = Schema.Literals([
  "malformed-event",
  "invalid-signature",
  "unwatched-author",
  "unsupported-kind",
  "malformed-profile",
  "other-d-tag",
  "expired",
  "stale",
]);
export type ProfileDropReason = typeof ProfileDropReason.Type;

/**
 * A watched relay event `ProfileWatch` chose not to surface. Inspector-only:
 * the watch stream itself carries facts, never drops.
 */
export class ProfileEventDropped extends Schema.TaggedClass<ProfileEventDropped>()(
  "ProfileEventDropped",
  {
    eventId: Schema.NullOr(EventId),
    reason: ProfileDropReason,
  },
) {}
