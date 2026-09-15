# Testing

Unit tests only, `src/**/*.test.ts`, vitest with globals, run by `bun run --filter @linky/linksync test` and by the root `bun run test`. Nothing here needs Evolu's runtime, a worker, or a browser.

## Testing a consumer

Build a store over the in-memory port and pass it to the repositories:

```ts
import {
  createLinkyStore,
  linkyTableColumns,
  makeContactsRepository,
  makeInMemoryShardDb,
} from "@linky/linksync";
import type { LinkyDbSchema } from "@linky/linksync";
import { createAppOwner, OwnerSecret } from "@evolu/common";

const appOwner = createAppOwner(
  OwnerSecret.orThrow(new Uint8Array(32).fill(1)),
);
const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
const store = createLinkyStore(db, appOwner);
const contacts = makeContactsRepository(store);
```

`db.readTable(table)` shows every copy in every shard, which is how a test asserts where a row went; `db.usedOwners()` shows the subscribe set after `store.reconcileSync()`.

## Testing package internals

`src/testing` holds fixtures, excluded from the app build and not exported: `toy.ts` (a domain-free schema, `toyStore()`, `testAppOwner(seed)`, and `run`/`tick` over a manual clock for the cooldown rules) and `linky.ts` (`linkyStore()` and `runNow`).

The core suite (`src/core/shardStore.test.ts`) covers every rule in [concepts](./concepts.md): insert goes to the active shard; an update from an old shard tombstones there and copies to the active one; merged reads take the newest copy; rotation moves the pointer, honors both thresholds and the cooldown, and old shards receive no inserts; a forgettable scope subscribes the newest N; forgetting deletes through the port; legacy ingest is idempotent and does not resurrect deletions. Each repository has its own `*.test.ts` on the in-memory port.
