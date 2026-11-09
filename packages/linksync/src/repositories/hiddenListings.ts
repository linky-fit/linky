import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import { hiddenListingIdFor } from "../model/ids";
import type { HiddenListingRow, LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

export interface HiddenListingsRepository extends TableRepository<
  LinkyDbSchema["hiddenListing"]
> {
  /** Hides someone's listing, or shows it again; a listing already in that state writes nothing. */
  readonly setHidden: (
    author: Pubkey,
    listingId: string,
    hidden: boolean,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

/** What `hiddenListingKeysOf` holds for one listing. */
export const hiddenListingKey = (author: string, listingId: string): string =>
  `${author}:${listingId}`;

/** The hidden listings as `hiddenListingKey`s; a row still arriving column by column is skipped. */
export const hiddenListingKeysOf = (
  rows: ReadonlyArray<HiddenListingRow>,
): ReadonlySet<string> =>
  new Set(
    rows.flatMap(({ authorPubkey, listingId }) =>
      authorPubkey === null || listingId === null
        ? []
        : [hiddenListingKey(authorPubkey, listingId)],
    ),
  );

/** Others' listings the user hid, whoever their author is, in the never-forgotten contacts scope. */
export const makeHiddenListingsRepository = (
  store: LinkyStore,
): HiddenListingsRepository => {
  const table = tableRepository(store, "contacts", "hiddenListing");
  return {
    ...table,
    setHidden: (author, listingId, hidden) =>
      Effect.gen(function* () {
        const id = hiddenListingIdFor(author, listingId);
        if (((yield* table.byId(id)) !== null) === hidden) return;
        yield* hidden
          ? table.insert({
              id,
              authorPubkey: NonEmptyString100.orThrow(author),
              listingId: NonEmptyString1000.orThrow(listingId),
            })
          : table.remove(id);
      }),
  };
};
