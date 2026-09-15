# Wallet

`makeWalletRepository(store)` (`src/repositories/wallet.ts`) implements linkshu's `ProofStore` and `OperationStore` ports over the `cashu` scope, which is never forgotten. Give the layers to `linkshuServices` or `runLinkshu`:

```ts
import { makeWalletRepository } from "@linky/linksync";
import { runLinkshu } from "@linky/linkshu";

const wallet = makeWalletRepository(store);
await runLinkshu(
  {
    bip39Seed,
    proofStore: wallet.proofStore,
    operationStore: wallet.operationStore,
  },
  effect,
);
```

| Member                         | Contract                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `proofs`, `proofStore`         | `ProofStoreService` and its `Layer`. Ids are `cashuProofIdFor(secret)`; inserting a stored secret upserts that row and keeps its `createdAt`. |
| `operations`, `operationStore` | `OperationStoreService` and its `Layer`. Ids are `cashuOperationIdFor(operationKeyOf(op))`; re-insert replaces every field.                   |
| `subscribe(listener)`          | Fires after any change to the scope.                                                                                                          |

Both `update`s apply only the present patch fields and are a no-op for an unknown id (including a value that is not an Evolu id). `loadAll` returns every row that decodes as `StoredProof` / `StoredOperation`; a row missing a required column is skipped, not repaired.

The phantom-row trap the app's adapters guarded against (an update aimed at the active lane on a proof living in an older lane) cannot happen here: the store copies the proof into the active shard and tombstones the old copy, and `loadAll` reads the copy. `toStoredProof` and `toStoredOperation` are exported for the migration.
