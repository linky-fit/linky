import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import { hiddenListingIdFor, pinnedListingIdFor } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainRow,
  type DomainTableRepository,
} from "./domainRepository";

export type HiddenListingRecord = DomainRow<LinkyDbSchema["hiddenListing"]>;
export type PinnedListingRecord = DomainRow<LinkyDbSchema["pinnedListing"]>;

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

export interface HiddenListingsRepository extends DomainTableRepository<
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
  const table = domainTableRepository(store, "contacts", "hiddenListing");
  return {
    ...table,
    setHidden: (author, listingId, hidden) =>
      Effect.gen(function* () {
        const id = hiddenListingIdFor(author, listingId);
        if (((yield* table.byId(id)) !== null) === hidden) return;
        yield* hidden
          ? table.insert({ id, authorPubkey: author, listingId })
          : table.remove(id);
      }),
  };
};

export interface PinnedListingsRepository extends DomainTableRepository<
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
  const table = domainTableRepository(store, "contacts", "pinnedListing");
  return {
    ...table,
    setPinned: (author, listingId, pinned) =>
      Effect.gen(function* () {
        const id = pinnedListingIdFor(author, listingId);
        if (((yield* table.byId(id)) !== null) === pinned) return;
        yield* pinned
          ? table.insert({ id, authorPubkey: author, listingId })
          : table.remove(id);
      }),
  };
};
