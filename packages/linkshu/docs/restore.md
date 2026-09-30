# Restore

`Restore` recovers proofs from the seed (NUT-09) across mints and keysets. Use it on a fresh device, after a lost inventory, or whenever the balance looks lower than it should. It also owns `wipeSeedBoundState`, which you must run when the seed changes.

## Example

The runtime must be built from the wallet's original seed; NUT-09 only finds proofs that seed derived. On a fresh device the stores know no mints, so pass every mint the wallet may have used.

```ts
import { Effect } from "effect";
import { Restore, RestoreDraft } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";

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

Omit `mints` to scan every mint the package knows (`Mints.knownMints`).

## How it works

Every candidate mint's wallet and keyset list is loaded first (failure → `unavailableMints`) to fix the scan total. Then every `sat` keyset the mint lists now, plus every keyset it has shown this wallet before, is scanned under the counter lock:

1. The secrets of every stored proof (any state, `spent` included) are read, so nothing is imported twice.
2. The positions just behind the counter are scanned first. If that finds nothing and the wallet has scanned this keyset before, the whole derivation tree is rescanned from zero.
3. Only proofs that are not stored and that the mint explicitly reports `UNSPENT` are kept. A failed state check imports nothing.
4. The proofs are stored `available`, then the restore cursor and the deterministic counter advance past the last signature. A crash between the two costs a rescan, never the funds.

A mint is either fully scanned (`scannedMints`) or reported as not scanned (`unavailableMints`); one unreachable keyset puts the mint in the second list even if other keysets restored proofs. A report can carry both `restoredProofs` and `unavailableMints`: the proofs are kept, scan the listed mints again later.

Restore knows nothing about operations: proofs it finds land as balance with no `operationId`, even if a pending melt or send once held them. Run the resumers and `Validation.checkIssued` afterwards when that matters.

A seed-only recovery has no cursor, so it walks the full derivation tree of every keyset. Expect the first scan to take noticeably longer than later ones.

### `restoreAndReclaim`

`restoreAndReclaim(draft, onProgress?)` scans with the same rules, then swaps only the proofs that scan inserted through `Tokens.reclaim`, so older copies of them die at the mint. It returns `{ restore: RestoreReport, reclaim: ReclaimReport }`; `reclaim.reclaimedAmount` is the amount refreshed after fees, and `restore.unavailableMints` plus `reclaim.unresolvedProofs` show what is incomplete. If the swap fails after discovery, the discovered proofs stay stored and a later scan skips them as known; retry their swap with `Tokens.reclaim`.

### Progress

Both `restore(draft, onProgress?)` and `restoreAndReclaim` accept a synchronous callback receiving `RestoreProgress`: `phase` (`preparing`, `scanning`, `refreshing`), `completedKeysets`, `totalKeysets`, `totalMints`. `scanning` starts with a fixed total and reports after each keyset attempt, failed ones included; each keyset counts equally, so the fraction measures attempts, not time. `refreshing` precedes the reclaim swap and has no percentage. The callback must not throw.

### The seed-bound wipe

Counters and cursors describe positions only the current seed can reproduce; reusing them under a new seed would collide at the mint. Replacing the seed goes in this order: dispose the old runtime, wipe over the same durable `KeyValueStore`, start the new one.

```ts
import { Effect } from "effect";
import { Restore, runLinkshu } from "@linky-fit/linkshu";

await oldRuntime.dispose();
await runLinkshu(
  { bip39Seed: nextSeed, keyValueStore },
  Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
);
// then build the new runtime over the same stores
```

The wipe removes the deterministic counters, their leases, and the restore cursors. It leaves proofs, operations (pending ones included), seen mints and keysets, and the fee-probe cache alone.

## Errors

`restore`, `restoreAndReclaim`, and `wipeSeedBoundState` never fail. Unreachable mints, lock timeouts, and rejected scans land in `unavailableMints`; a failed reclaim swap in `unresolvedProofs`.

## Related

- [tokens.md](./tokens.md#reclaim): the swap `restoreAndReclaim` runs
- [topup.md](./topup.md): interrupted claims reclaim through the same NUT-09 call
- [concepts.md](./concepts.md#deterministic-counters-and-the-lease): why the wipe is mandatory
