import { Effect } from "effect";
import type { Patch, ShardDbError } from "../core";
import { activeNostrIdentityId } from "@linky/domain";
import type { LinkyDbSchema, NostrIdentityRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository } from "./tableRepository";

type IdentityColumns = Omit<Patch<LinkyDbSchema["nostrIdentity"]>, "nsec"> & {
  readonly nsec: LinkyDbSchema["nostrIdentity"]["nsec"];
};

export interface IdentityRepository {
  /** The active identity as the newest row says; null before the first `set`. */
  readonly current: Effect.Effect<NostrIdentityRow | null>;
  readonly set: (
    identity: IdentityColumns,
  ) => Effect.Effect<void, ShardDbError>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** One synced row mirrors the active Nostr key so another device can adopt it. */
export const makeIdentityRepository = (
  store: LinkyStore,
): IdentityRepository => {
  const table = tableRepository(store, "identity", "nostrIdentity");
  const newestFirst = (rows: ReadonlyArray<NostrIdentityRow>) =>
    [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    current: Effect.map(table.all, (rows) => newestFirst(rows)[0] ?? null),
    set: (identity) =>
      Effect.flatMap(table.byId(activeNostrIdentityId), (existing) =>
        existing === null
          ? table.insert({ id: activeNostrIdentityId, ...identity })
          : table
              .update(activeNostrIdentityId, identity)
              .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
      ),
    subscribe: table.subscribe,
  };
};
