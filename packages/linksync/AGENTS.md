# @linky-fit/linksync

`src/model/scopes.ts` is the source of truth for owner types, rotation rules and forget policies; `docs/concepts.md` renders it and `src/model/scopes.test.ts` fails when they drift, so a scope change edits both. A new repository gets a section in `docs/repositories.md`.

## Rules that are easy to break

- Never update a row in place in a shard that is not the active one; `ShardStore.update` copies it forward and tombstones the old copy.
- Never let an owner id, a table name, or a shard index reach a consumer; if a caller needs one, the function belongs here.
- Every repository write ends with `maybeRotate`; a batch of raw store writes runs it once. A rejected pointer write is logged, never raised.
- `ShardRetention` state is device-local and must never sync.
