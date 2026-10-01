# Mints

`Mints` answers "what do I know about this mint" and "which mints does this wallet have state for". `FeeProbe` measures a mint's Lightning fee. Both need a configured runtime ([getting-started.md](./getting-started.md)).

## Example

```ts
import { Effect } from "effect";
import { Mints, parseMintUrl } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";

const describeMint = (raw: string) =>
  Effect.gen(function* () {
    const mint = parseMintUrl(raw);
    if (mint === null) return null;
    const mints = yield* Mints;
    const info = yield* mints.info(mint);
    const fee =
      info.inputFeePpk === null ? "unknown" : `${info.inputFeePpk} ppk`;
    return `${info.name ?? info.url}: input fee ${fee}, MPP ${info.supportsMpp ? "yes" : "no"}`;
  });

const forgetMint = (mint: MintUrl) =>
  Effect.flatMap(Mints, (mints) => mints.removeKnownMint(mint)).pipe(
    Effect.as("forgotten"),
    Effect.catchTag("MintInUse", (inUse) =>
      Effect.succeed(`still holds ${inUse.proofCount} unspent proofs`),
    ),
  );
```

Always go through `parseMintUrl` (or `MintUrl.make` on already-normalized input): the package compares mints by their form without a trailing slash, and two spellings of one mint would fork its counters.

## How it works

### `info`

`info(mint)` loads the mint's published info (NUT-06), keysets, and keys, and returns a `MintInfo`. `inputFeePpk` is the fee of the keyset the wallet spends from (the lowest-fee active `sat` keyset). `isFakeLightning` is true for `localhost`, `127.0.0.1`, `testnut.cashu.space`, or info text advertising a FakeWallet.

Successful wallet loads are cached for the runtime's lifetime; a failed load is evicted so the next call retries, and so is one its caller stopped waiting for (`Receive` waits 15 s), so the next call starts a fresh load instead of awaiting a stalled one. Keyset verification failures surface as `MintRejected`; there is no fallback that accepts rejected keys. A mint with only inactive keysets can still load for restore.

### The known-mint set

`knownMints` is the union of the mints named by stored proofs (any state), by stored operations (`mint`, and `sourceMint` of autoswaps), and the seen mints. A mint is recorded as seen the first time any operation loads its wallet successfully, `Mints.info` included, or explicitly through `addKnownMint`, which needs no network and registers a mint before it holds funds. `Restore` scans `knownMints` when given no `mints`.

`removeKnownMint` removes a mint from the seen set. It fails with `MintInUse` while any proof at the mint is not `spent` (`available`, `held`, `handedOut`, or `externalized` alike). A mint still named by `spent` proofs or by operations can be forgotten and comes back into `knownMints` through them. `Restore.wipeSeedBoundState` leaves the seen set alone.

### Icons

`GENERIC_MINT_ICON_DATA_URL`, `getMintIconOverride(host)`, `findMintInfoIconValue(value, new Set())`, and `isTestMintUrl(mint)` are pure helpers that need no runtime; `MintInfo.iconUrl` is what `info` found with them, resolved against the mint URL.

## Lightning fee probe

Mints publish no Lightning fee (NUT-06 has no field for it), so `FeeProbe.probeLightningFee` asks for a melt quote against a real invoice and reads the fee reserve. Nothing is paid.

```ts
import { Effect } from "effect";
import { FeeProbe, FeeProbeDraft, MintUrl } from "@linky-fit/linkshu";

const lightningFee = Effect.gen(function* () {
  const feeProbe = yield* FeeProbe;
  const result = yield* feeProbe.probeLightningFee(
    new FeeProbeDraft({
      mint: MintUrl.make("https://mint.example"),
      probeMint: MintUrl.make("https://other-mint.example"),
    }),
  );
  return `${result.percent.toFixed(2)} % (${result.feeReserve} sat on ${result.amount})`;
});
```

1. A cached result for `mint` younger than 24 h is returned as is; no request is made.
2. Otherwise a mint quote for `amount` (default 10 000 sat) is created at `probeMint` to obtain an invoice, and `mint` is asked for a melt quote on it. `feeReserve` and `percent = feeReserve / amount × 100` come from that quote. The whole probe is capped at 15 s.
3. The result is cached in the `KeyValueStore` and a `LightningFeeProbed` inspector row emitted.

Pick `probeMint` as a different, Lightning-backed mint; a mint quoting a melt to its own invoice is not representative. The probe never pays, mints, or melts (both quotes expire on their own), never touches stored proofs or counters, and never retries; a failure is not cached.

## Errors

| Tag               | Raised by                   | When                                                                          |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `MintInUse`       | `removeKnownMint`           | unspent proofs still name the mint (`proofCount` says how many)               |
| `MintUnreachable` | `info`, `probeLightningFee` | wallet load failed, either probe mint unreachable, or the probe exceeded 15 s |
| `MintRejected`    | `info`, `probeLightningFee` | unusable info or keysets; a quote without invoice or fee reserve              |

`knownMints` and `addKnownMint` never fail; `removeKnownMint` is a no-op for a mint that was never seen.

## Related

- [restore.md](./restore.md): consumer of `knownMints`
- [melt.md](./melt.md): where the real Lightning fee is charged
