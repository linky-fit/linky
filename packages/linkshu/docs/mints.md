# Mints

`Mints` answers "what do I know about this mint" and "which mints does this wallet have state for". Use `info` for the mint settings page (name, fees, multi-part payment support, icon) and `knownMints` when you need every mint the wallet has touched.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)); `info` needs the mint reachable, `knownMints` works offline.

Two fields need their units first. `inputFeePpk` is the mint's cashu input fee in parts per thousand per proof spent: spending 10 proofs at 100 ppk costs 1 sat. `supportsMpp` says the mint accepts multi-part Lightning payments (NUT-15), so one invoice can be paid in parts from several mints.

```ts
import { Effect } from "effect";
import { Mints, parseMintUrl } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";

const describeMint = (raw: string) =>
  Effect.gen(function* () {
    const mint = parseMintUrl(raw);
    if (mint === null) return null;
    const mints = yield* Mints;
    const info = yield* mints.info(mint);
    const fee =
      info.inputFeePpk === null ? "unknown" : `${info.inputFeePpk} ppk`;
    return `${info.name ?? info.url}: input fee ${fee}, multi-part payments ${info.supportsMpp ? "yes" : "no"}`;
  });

const listMints: Effect.Effect<
  ReadonlyArray<MintUrl>,
  never,
  Mints
> = Effect.flatMap(Mints, (mints) => mints.knownMints);
```

Always go through `parseMintUrl` (or `MintUrl.make` on already-normalized input): the package compares mints by their normalized form without a trailing slash, and two spellings of one mint would fork its counters.

## How it works

`info(mint)` loads the mint's published info (NUT-06), keysets, and keys, and returns a `MintInfo` (`mint/domain.ts`):

| Field             | Type                                                   | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `url`             | `MintUrl`                                              | normalized                                                                                                   |
| `name`            | `Schema.NullOr(Schema.String)`                         | published `name`, or null                                                                                    |
| `inputFeePpk`     | `Schema.NullOr(Schema.Int.pipe(Schema.nonNegative()))` | cashu input fee of the keyset the wallet spends from (lowest-fee active `sat` keyset); null when unpublished |
| `supportsMpp`     | `Schema.Boolean`                                       | NUT-15 multi-part payments                                                                                   |
| `isFakeLightning` | `Schema.Boolean`                                       | known test URL (`localhost`, `127.0.0.1`, `testnut.cashu.space`) or info text advertising a FakeWallet       |
| `iconUrl`         | `Schema.NullOr(Schema.String)`                         | an icon URL found in the published info, resolved against the mint URL                                       |

`inputFeePpk` is the **cashu** fee; the Lightning fee is a separate figure from [fee-probe.md](./fee-probe.md).

### The known-mint set

`knownMints` is the union of the mints named by stored rows (any state) and the _seen_ mints. There is no explicit "add" call: a mint is recorded as seen the first time any operation loads its wallet successfully — `Mints.info` included. So to register a mint, call `info` on it. Nothing removes a seen mint; `Restore.wipeSeedBoundState` leaves this set alone. Restore defaults to this set when you pass no `mints`.

Successful wallet loads are cached for the runtime's lifetime; a failed load is evicted so the next call retries.

### Icons (`mint/icons.ts`)

Pure helpers, no runtime needed:

| Export                               | Use                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `GENERIC_MINT_ICON_DATA_URL`         | inline SVG fallback                                                          |
| `getMintIconOverride(host)`          | hand-picked icon URLs for well-known mints, by host; null otherwise          |
| `findMintInfoIconValue(value, seen)` | deep search of a NUT-06 info object for an icon-ish string; pass `new Set()` |
| `isTestMintUrl(mint)`                | true for local/test hosts                                                    |

## Inputs and outputs

`info(mint: MintUrl)`: `Effect<MintInfo, MintUnreachable | MintRejected>` — fields above.

`knownMints`: `Effect<ReadonlyArray<MintUrl>>`, sorted.

## Errors

| Tag               | Raised by | When                                                | What to do                                    |
| ----------------- | --------- | --------------------------------------------------- | --------------------------------------------- |
| `MintUnreachable` | `info`    | network/timeout/5xx during wallet load              | retry later; show cached info if you keep any |
| `MintRejected`    | `info`    | the mint answered but its info/keysets are unusable | surface `detail`                              |

`knownMints` never fails.

## Related

- [fee-probe.md](./fee-probe.md) — the Lightning side of fees
- [restore.md](./restore.md) — consumer of `knownMints`
- [ports.md](./ports.md)
