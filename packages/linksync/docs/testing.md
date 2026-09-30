# Testing

Unit tests only, `src/**/*.test.ts`, vitest with globals, run by `bun run --filter @linky-fit/linksync test` and the root `bun run test`. Nothing needs Evolu's runtime or a worker; `src/react/index.test.ts` opts into jsdom with a file-level `@vitest-environment` comment.

## Testing a consumer

Build a store over the in-memory port and pass it to the repositories:

```ts
import {
  createLinkyStore,
  linkyTableColumns,
  makeContactsRepository,
  makeInMemoryShardDb,
} from "@linky-fit/linksync";
import type { LinkyDbSchema } from "@linky-fit/linksync";
import { createAppOwner, OwnerSecret } from "@evolu/common";

const appOwner = createAppOwner(
  OwnerSecret.orThrow(new Uint8Array(32).fill(1)),
);
const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
const store = createLinkyStore(db, appOwner);
const contacts = makeContactsRepository(store);
```

`db.readTable(table)` shows every copy in every shard, which is how a test asserts where a row went; `db.usedOwners()` shows the subscribe set after `store.reconcileSync()`. Pass `createLinkyStore` its own `scopes` to test rotation with small thresholds.

Package-internal fixtures live in `src/testing` (`toy.ts`: a domain-free schema, `toyStore()`, a manual clock; `linky.ts`: `linkyStore()`, `runNow`), excluded from the app build and not exported.
