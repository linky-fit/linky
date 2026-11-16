import { NonEmptyString, NonEmptyString100, PositiveInt } from "@evolu/common";
import { Pubkey } from "@linky-fit/linkstr";
import { Effect, Option, Schema } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import { peerListingsIdFor } from "../model/ids";
import type { LinkyDbSchema, PeerListingsRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

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
  row: PeerListingsRow,
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

export interface PeerListingsRepository extends TableRepository<
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
  const table = tableRepository(store, "peerListings", "peerListings");
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
        const publishedAt = PositiveInt.orThrow(publishedAtSec);
        if (stored === null) {
          yield* table.insert({
            id,
            readerPubkey: NonEmptyString100.orThrow(reader),
            authorPubkey: NonEmptyString100.orThrow(author),
            document: NonEmptyString.orThrow(document),
            publishedAtSec: publishedAt,
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
            ? { publishedAtSec: publishedAt }
            : {
                document: NonEmptyString.orThrow(document),
                publishedAtSec: publishedAt,
              },
        );
        return true;
      }),
  };
};
