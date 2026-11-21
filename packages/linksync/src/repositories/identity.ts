import { activeNostrIdentityId } from "@linky-fit/domain";
import { Effect } from "effect";
import type { ShardDbError } from "../core";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainPatch,
  type DomainRow,
} from "./domainRepository";

export type NostrIdentityRecord = DomainRow<LinkyDbSchema["nostrIdentity"]>;

export type IdentityInput = Omit<
  DomainPatch<LinkyDbSchema["nostrIdentity"]>,
  "nsec"
> & {
  readonly nsec: string;
};

export interface IdentityRepository {
  /** The active identity as the newest row says; null before the first `set`. */
  readonly current: Effect.Effect<NostrIdentityRecord | null>;
  readonly set: (identity: IdentityInput) => Effect.Effect<void, ShardDbError>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** One synced row mirrors the active Nostr key so another device can adopt it. */
export const makeIdentityRepository = (
  store: LinkyStore,
): IdentityRepository => {
  const table = domainTableRepository(store, "identity", "nostrIdentity");
  const newestFirst = (rows: ReadonlyArray<NostrIdentityRecord>) =>
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
