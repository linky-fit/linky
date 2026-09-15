# @linky/linksync

Usage guides for this package live in `docs/` (index: `docs/README.md`). Read [concepts](./docs/concepts.md) before changing a scope or a table: the scope table there is the source of truth for owner type, rotation rule, and forget policy, and `src/model/scopes.ts` must match it.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` or `src/evolu/index.ts` (the schema, ids, scopes, the store, a repository, the port) or the behavior a guide describes — is done only when the matching `docs/*.md` file is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface, every table row still names a real column or method, a new scope has its row in the scope table, and a new repository has its own guide linked from `docs/README.md`.

## Rules that are easy to break

- Never update a row in place in a shard that is not the active one; go through `ShardStore.update`, which copies the row forward and tombstones the old copy.
- Never write `ownerId`, a table name, or a shard index into app code; if you need one, the function belongs here.
- The Evolu runtime (`createQuery`, `loadQuery`, `upsert`, `update`, `useOwner`) is called only in `src/evolu/evoluShardDb.ts`.
