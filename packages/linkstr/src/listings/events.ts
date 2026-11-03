import { Schema } from "effect";
import { EventId, Pubkey, UnixSeconds } from "../domain/primitives";
import { ListingsDocument } from "./domain";

/**
 * Facts emitted by `Listings.watch`. Linkstr persists nothing: consumers
 * compare `updatedAt` against their own cache.
 */

/** An author's current document, decrypted through the reader's own key slot. */
export class ListingsUpdated extends Schema.TaggedClass<ListingsUpdated>()(
  "ListingsUpdated",
  {
    pubkey: Pubkey,
    document: ListingsDocument,
    updatedAt: UnixSeconds,
  },
) {}

export const ListingsDropReason = Schema.Literals([
  "malformed-event",
  "invalid-signature",
  "unwatched-author",
  "unsupported-kind",
  "other-d-tag",
  /** No key slot for the reader: the author does not share with them (or an older version did not). */
  "no-slot",
  "undecryptable",
  "malformed-document",
  "stale",
]);
export type ListingsDropReason = typeof ListingsDropReason.Type;

/**
 * A watched relay event `Listings.watch` chose not to surface. Inspector-only:
 * the watch stream itself carries facts, never drops.
 */
export class ListingsEventDropped extends Schema.TaggedClass<ListingsEventDropped>()(
  "ListingsEventDropped",
  {
    eventId: Schema.NullOr(EventId),
    reason: ListingsDropReason,
  },
) {}
