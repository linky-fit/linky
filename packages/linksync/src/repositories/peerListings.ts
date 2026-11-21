import { Pubkey } from "@linky-fit/linkstr";
import { Effect, Option, Schema } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import { peerListingsIdFor } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainRow,
  type DomainTableRepository,
} from "./domainRepository";

export type PeerListingsStoredRow = DomainRow<LinkyDbSchema["peerListings"]>;

/** One author's newest listings document as one of the user's identities read it. */
export interface PeerListingsRecord {
  readonly reader: Pubkey;
  readonly author: Pubkey;
  /** The document JSON, for the consumer to validate. */
  readonly document: string;
  readonly publishedAtSec: number;
}

const decodePubkey = Schema.decodeUnknownOption(Pubkey);

/** The record of a row, or null while the row is still arriving column by column. */
export const normalizePeerListings = (
  row: PeerListingsStoredRow,
): PeerListingsRecord | null => {
  const reader = decodePubkey(row.readerPubkey);
  const author = decodePubkey(row.authorPubkey);
  if (
    Option.isNone(reader) ||
    Option.isNone(author) ||
    row.document === null ||
    row.publishedAtSec === null
  ) {
    return null;
  }
  return {
    reader: reader.value,
    author: author.value,
    document: row.document,
    publishedAtSec: row.publishedAtSec,
  };
};

export interface PeerListingsRepository extends DomainTableRepository<
  LinkyDbSchema["peerListings"]
> {
  /** The documents `reader` read, one per author. */
  readonly ofReader: (
    reader: Pubkey,
  ) => Effect.Effect<ReadonlyArray<PeerListingsRecord>>;
  /**
   * Stores a document published strictly later than the stored one; an
   * unchanged document only moves the time. Returns whether it wrote.
   */
  readonly record: (
    record: PeerListingsRecord,
  ) => Effect.Effect<boolean, ShardDbError | RowNotFound>;
}

/** Others' listings documents, kept until a newer one replaces them, in the `peerListings` scope. */
export const makePeerListingsRepository = (
  store: LinkyStore,
): PeerListingsRepository => {
  const table = domainTableRepository(store, "peerListings", "peerListings");
  return {
    ...table,
    ofReader: (reader) =>
      Effect.map(table.all, (rows) =>
        rows.flatMap((row) => {
          const record = normalizePeerListings(row);
          return record !== null && record.reader === reader ? [record] : [];
        }),
      ),
    record: ({ reader, author, document, publishedAtSec }) =>
      Effect.gen(function* () {
        const id = peerListingsIdFor(reader, author);
        const stored = yield* table.byId(id);
        if (stored === null) {
          yield* table.insert({
            id,
            readerPubkey: reader,
            authorPubkey: author,
            document,
            publishedAtSec,
          });
          return true;
        }
        if (
          stored.publishedAtSec !== null &&
          stored.publishedAtSec >= publishedAtSec
        ) {
          return false;
        }
        yield* table.update(
          id,
          stored.document === document
            ? { publishedAtSec }
            : { document, publishedAtSec },
        );
        return true;
      }),
  };
};
