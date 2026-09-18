import { createAppOwner, OwnerSecret } from "@evolu/common";
import {
  createLinkyStore,
  linkyTableColumns,
  makeInMemoryShardDb,
  type LinkyDbSchema,
} from "@linky/linksync";

/** A linksync store over the in-memory port, for hooks and helpers that take a repository. */
export const makeTestLinkyStore = (seed = 1) => {
  const appOwner = createAppOwner(
    OwnerSecret.orThrow(new Uint8Array(32).fill(seed)),
  );
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
  return { appOwner, db, store: createLinkyStore(db, appOwner) };
};
