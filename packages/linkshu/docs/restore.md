# Restore

`Restore` recovers proofs from the seed (NUT-09) across mints and keysets. Use it on a fresh device, after a crash that lost the inventory, or whenever the balance looks lower than it should. It also owns `wipeSeedBoundState`, which you must call when the seed changes.

## Quick example

Prerequisites: a runtime built from the wallet's **original seed** ([getting-started.md](./getting-started.md)) — NUT-09 only finds proofs that seed derived. On a fresh device the stores are empty and know no mints, so pass every mint the wallet may have used.

```ts
import { Effect } from "effect";
import { Restore, RestoreDraft } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";

const restoreFrom = (mints: ReadonlyArray<MintUrl>) =>
  Effect.gen(function* () {
    const restore = yield* Restore;
    const report = yield* restore.restore(new RestoreDraft({ mints }));
    console.log(
      report.restoredAmount,
      "sat in",
      report.restoredProofs,
      "proofs",
    );
    return report.unavailableMints; // scan these again later
  });
```

Omit `mints` to scan every mint the package knows (`Mints.knownMints`). Linky passes its own list (`useRestoreMissingTokens.ts`) because the app knows more candidates than the stores — the mint list, the default and main mints. Pass what you know.

## How it works

Per mint: load the wallet (failure → `unavailableMints`). Every `sat` keyset the mint lists now, plus every keyset it has shown this wallet before, is scanned under the counter lock:

1. The secrets of every stored proof (any state, `spent` included) are read, so nothing is imported twice — a spent proof restored again would be balance the mint will not honor.
2. The positions just behind the counter are scanned first. If that finds nothing and the wallet has scanned this keyset before, the whole derivation tree is rescanned from zero. A scan ends after 1000 unsigned positions in a row (`DERIVATION_GAP_LIMIT`): operations reserve 64-slot output blocks and a failed attempt leaves its block unsigned, so a shorter gap limit would stop inside a tree that still has live signatures ahead and leave the counter on slots the mint has signed.
3. Only proofs that are not stored and that the mint explicitly reports `UNSPENT` are kept. A failed state check imports nothing.
4. The proofs are stored `available` (`restore`), **then** the restore cursor and the deterministic counter advance past the last signature. A crash between the two costs a rescan, never the funds.

A mint is either fully scanned (`scannedMints`) or reported as not scanned (`unavailableMints`) — one unreachable keyset puts the mint in the second list even if other keysets restored proofs. A report can therefore carry both `restoredProofs` and `unavailableMints`; the proofs are kept, scan the listed mints again later.

Restore knows nothing about operations: proofs it finds land as balance with no `operationId`, even if a pending melt or send once held them. Run the resumers and `Validation.checkIssued` afterwards when that matters.

### What a fresh-device scan costs

A seed-only recovery has no cursor, so it walks the full derivation tree of every keyset. Expect it to take noticeably longer than later restores, and to happen once; afterwards the cursor keeps later scans short.

### How progress is reported

`restore` returns one `RestoreReport` at the end. Live progress exists only as inspector rows: `ProofsChanged` with `reason: "restore"` per keyset that stored proofs, and `CounterAdvanced` with `reason: "restore"` per keyset. Wire the [inspector](./inspector.md) if you want a progress UI.

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
import type { Bip39Seed, LinkshuServicesConfig } from "@linky/linkshu";

const switchSeed = async (
  current: { dispose: () => Promise<void> },
  nextSeed: Bip39Seed,
  stores: Omit<LinkshuServicesConfig, "bip39Seed">,
) => {
  await current.dispose();
  await runLinkshu(
    { bip39Seed: nextSeed, keyValueStore: stores.keyValueStore },
    Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
  );
  return ManagedRuntime.make(
    linkshuServices({ bip39Seed: nextSeed, ...stores }).pipe(
      Layer.provideMerge(Inspector.disabled),
    ),
  );
};
```

The wipe removes the deterministic counters, their leases, and the restore cursors. It leaves proofs, operations (pending topup/autoswap/melt included), seen mints/keysets, and the fee-probe cache alone. Linky runs it from `platform/linkshu/wipeLinkshuSeedBoundState.ts` whenever the cashu mnemonic changes.

## Inputs and outputs

`RestoreDraft` (`restore/domain.ts`):

| Field   | Type                                     | Notes                        |
| ------- | ---------------------------------------- | ---------------------------- |
| `mints` | `Schema.optional(Schema.Array(MintUrl))` | defaults to every known mint |

`RestoreReport`:

| Field              | Type                    | Notes                      |
| ------------------ | ----------------------- | -------------------------- |
| `restoredAmount`   | `NonNegativeAmount`     | sum over the new proofs    |
| `restoredProofs`   | `Schema.Int`            | `available` proofs created |
| `scannedMints`     | `Schema.Array(MintUrl)` | every keyset scanned       |
| `unavailableMints` | `Schema.Array(MintUrl)` | scan again later           |

## Errors

`restore` and `wipeSeedBoundState` never fail. Unreachable mints, lock timeouts, and rejected scans all land in `unavailableMints`.

## Related

- [topup.md](./topup.md) — interrupted claims reclaim through the same NUT-09 call
- [validation.md](./validation.md)
- [ports.md](./ports.md) — the `KeyValueStore` the wipe runs over
- [../README.md](../README.md) — "Counters are sacred"
