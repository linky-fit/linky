# Restore

`Restore` recovers proofs from the seed (NUT-09) across mints and keysets. Use it on a fresh device, after a crash that lost rows, or whenever the balance looks lower than it should. It also owns `wipeSeedBoundState`, which you must call when the seed changes.

## Quick example

Prerequisites: a runtime built from the wallet's **original seed** ([getting-started.md](./getting-started.md)) — NUT-09 only finds proofs that seed derived. On a fresh device the store is empty and knows no mints, so pass every mint the wallet may have used.

```ts
import { Effect } from "effect";
import { Restore, RestoreDraft } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";

const restoreFrom = (mints: ReadonlyArray<MintUrl>) =>
  Effect.gen(function* () {
    const restore = yield* Restore;
    const report = yield* restore.restore(new RestoreDraft({ mints }));
    console.log(report.restoredAmount, "sat in", report.rows.length, "rows");
    return report.unavailableMints; // scan these again later
  });
```

Omit `mints` to scan every mint the package knows (`Mints.knownMints`). Linky passes its own list (`useRestoreMissingTokens.ts`) because the app knows more candidates than the store — soft-deleted rows, the mint list, the default and main mints. Pass what you know.

## How it works

Per mint: load the wallet (failure → `unavailableMints`). Every `sat` keyset the mint lists now, plus every keyset it has shown this wallet before, is scanned under the counter lock:

1. The secrets of every stored row (any state) are read, so nothing is imported twice.
2. The positions just behind the counter are scanned first. If that finds nothing and the wallet has scanned this keyset before, the whole derivation tree is rescanned from zero.
3. Only proofs that are not stored and that the mint explicitly reports `UNSPENT` are kept. A failed state check imports nothing.
4. The proofs are persisted as `accepted` rows (`restore`), **then** the restore cursor and the deterministic counter advance past the last signature. A crash between the two costs a rescan, never the funds.

A mint is either fully scanned (`scannedMints`) or reported as not scanned (`unavailableMints`) — one unreachable keyset puts the mint in the second list even if other keysets restored rows. A report can therefore carry both new `rows` and `unavailableMints`; the rows are kept, scan the listed mints again later.

### What a fresh-device scan costs

A seed-only recovery has no cursor, so it walks the full derivation tree of every keyset. Expect it to take noticeably longer than later restores, and to happen once; afterwards the cursor keeps later scans short.

### How progress is reported

`restore` returns one `RestoreReport` at the end. Live progress exists only as inspector rows: `TokenLifecycleChanged` per persisted row and `CounterAdvanced` with `reason: "restore"` per keyset. Wire the [inspector](./inspector.md) if you want a progress UI.

### The seed-bound wipe

Counters and cursors describe positions only the current seed can reproduce. Reusing them under a new seed would collide at the mint, so replacing or clearing the seed goes in this order: stop the old runtime, wipe over the **same durable `KeyValueStore`**, then start the new one.

```ts
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  Inspector,
  linkshuServices,
  Restore,
  runLinkshu,
} from "@linky/linkshu";
import type { Bip39Seed, KeyValueStore, TokenStore } from "@linky/linkshu";

const switchSeed = async (
  current: { dispose: () => Promise<void> },
  nextSeed: Bip39Seed,
  keyValueStore: Layer.Layer<KeyValueStore>,
  tokenStore: Layer.Layer<TokenStore>,
) => {
  await current.dispose();
  await runLinkshu(
    { bip39Seed: nextSeed, keyValueStore },
    Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
  );
  return ManagedRuntime.make(
    linkshuServices({ bip39Seed: nextSeed, keyValueStore, tokenStore }).pipe(
      Layer.provideMerge(Inspector.disabled),
    ),
  );
};
```

The wipe leaves token rows, seen mints/keysets, pending topup/autoswap/melt records, and the fee-probe cache alone. Linky runs it from `platform/linkshu/wipeLinkshuSeedBoundState.ts` whenever the cashu mnemonic changes.

## Inputs and outputs

`RestoreDraft` (`restore/domain.ts`):

| Field   | Type                                     | Notes                        |
| ------- | ---------------------------------------- | ---------------------------- |
| `mints` | `Schema.optional(Schema.Array(MintUrl))` | defaults to every known mint |

`RestoreReport`:

| Field              | Type                       | Notes                   |
| ------------------ | -------------------------- | ----------------------- |
| `restoredAmount`   | `NonNegativeAmount`        | sum over new rows       |
| `rows`             | `Schema.Array(TokenRowId)` | `accepted` rows created |
| `scannedMints`     | `Schema.Array(MintUrl)`    | every keyset scanned    |
| `unavailableMints` | `Schema.Array(MintUrl)`    | scan again later        |

## Errors

`restore` and `wipeSeedBoundState` never fail. Unreachable mints, lock timeouts, and rejected scans all land in `unavailableMints`.

## Related

- [topup.md](./topup.md) — interrupted claims reclaim through the same NUT-09 call
- [validation.md](./validation.md)
- [ports.md](./ports.md) — the `KeyValueStore` the wipe runs over
- [../README.md](../README.md) — "Counters are sacred"
