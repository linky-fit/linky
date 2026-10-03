import type { Filter } from "nostr-tools";
import type { Pubkey } from "../domain/primitives";
import { chunkAuthors } from "../internal/authorChunks";
import {
  PROFILE_BADGES_D,
  PROFILE_BADGES_KIND,
} from "../supporterBadges/codec";
import { PROFILE_KIND, STATUS_KIND } from "./codec";

/**
 * Profile and status filters for `authors`, one kind per filter: a relay that
 * disallows a kind (some reject 30315) closes the whole REQ, which would also
 * hide the other kind.
 */
export const profileFilters = (authors: ReadonlyArray<Pubkey>): Array<Filter> =>
  chunkAuthors(authors).flatMap((chunk) =>
    [PROFILE_KIND, STATUS_KIND].map((kind) => ({
      kinds: [kind],
      authors: chunk,
    })),
  );

export const profileBadgesFilters = (
  authors: ReadonlyArray<Pubkey>,
): Array<Filter> =>
  chunkAuthors(authors).map((chunk) => ({
    kinds: [PROFILE_BADGES_KIND],
    authors: chunk,
    "#d": [PROFILE_BADGES_D],
  }));
