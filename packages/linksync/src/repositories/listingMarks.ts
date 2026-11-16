import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import { hiddenListingIdFor, pinnedListingIdFor } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

/** What `listingKeysOf` holds for one listing. */
export const listingKey = (author: string, listingId: string): string =>
  `${author}:${listingId}`;

/** Hidden or pinned listings as `listingKey`s; a row still arriving column by column is skipped. */
export const listingKeysOf = (
  rows: ReadonlyArray<{
    readonly authorPubkey: string | null;
    readonly listingId: string | null;
  }>,
): ReadonlySet<string> =>
  new Set(
    rows.flatMap(({ authorPubkey, listingId }) =>
      authorPubkey === null || listingId === null
        ? []
        : [listingKey(authorPubkey, listingId)],
    ),
  );

const listingColumns = (author: Pubkey, listingId: string) => ({
  authorPubkey: NonEmptyString100.orThrow(author),
  listingId: NonEmptyString1000.orThrow(listingId),
});

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
          ? table.insert({ id, ...listingColumns(author, listingId) })
          : table.remove(id);
      }),
  };
};

export interface PinnedListingsRepository extends TableRepository<
  LinkyDbSchema["pinnedListing"]
> {
  /** Pins someone's listing, or unpins it; a listing already in that state writes nothing. */
  readonly setPinned: (
    author: Pubkey,
    listingId: string,
    pinned: boolean,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

/** Others' listings the user pinned to the top, whoever their author is, in the never-forgotten contacts scope. */
export const makePinnedListingsRepository = (
  store: LinkyStore,
): PinnedListingsRepository => {
  const table = tableRepository(store, "contacts", "pinnedListing");
  return {
    ...table,
    setPinned: (author, listingId, pinned) =>
      Effect.gen(function* () {
        const id = pinnedListingIdFor(author, listingId);
        if (((yield* table.byId(id)) !== null) === pinned) return;
        yield* pinned
          ? table.insert({ id, ...listingColumns(author, listingId) })
          : table.remove(id);
      }),
  };
};
