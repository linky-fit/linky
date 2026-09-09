# Validation

`Validation` asks mints which stored proofs are still unspent (NUT-07) and updates rows accordingly. Use it to verify the balance, to check one token, and to notice when an issued token has been claimed. It performs no swap and costs no signatures.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)). An empty wallet returns an empty report.

```ts
import { Effect } from "effect";
import { Validation } from "@linky/linkshu";

const checkWallet = Effect.gen(function* () {
  const validation = yield* Validation;
  const report = yield* validation.checkAll;
  return {
    spent: report.markedSpent.length,
    merged: report.mergedRows.length,
    offline: report.unavailableMints,
  };
});
```

## How it works

One batched checkstate call per mint+unit group. Per row:

| Mint's answer for the row                                   | What happens                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| every proof `SPENT`                                         | row → `error` with a serialized `TokenAlreadySpent`; reported in `markedSpent` |
| some proofs `UNSPENT`, all others `SPENT`                   | row keeps only the unspent proofs                                              |
| any proof `PENDING` / unanswered / unrecognized / truncated | nothing changes — a missing answer is never a guess                            |
| mint unreachable or rejects the query                       | whole group untouched; mint listed in `unavailableMints`                       |

**Merge.** Surviving proofs of a mint group are collapsed into the first live row (its `tokenText` rewritten locally) and the sibling rows removed; their ids come back in `mergedRows`. The primary carries the merged proofs before any sibling is removed.

### The three calls

| Call              | Rows considered               | Returns                                                                                         |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `checkAll`        | `accepted` only (the balance) | `ValidationReport`                                                                              |
| `checkRow(rowId)` | the supplied row, any state   | `RowCheckResult`; `"unavailable"` when the mint gave no usable answer or the row states no mint |
| `checkIssued`     | `issued` only                 | `IssuedClaimReport`; fully spent rows are **removed** (the recipient claimed them)              |

The batch calls skip `pending` and `reserved` rows; `checkRow` checks whatever row you give it. That is how `reserved` rows left by an interrupted melt are resolved (also not covered by `Tokens.deleteSpent`): run `checkRow` on each — fully spent flips it to `error`, live leaves it `reserved` for `Tokens.returnToWallet`. See [melt.md](./melt.md#recovering-an-interrupted-melt) for the order of steps. `externalized` and dead `error` rows are only reported, never re-marked.

Validation never resurrects a row: an `error` row with live proofs comes back only through `Tokens.returnToWallet`.

### When to run it

- `checkAll`: on the user's "check all" action. Not on every render — each run is one request per mint.
- `checkRow`: when opening a token's detail page.
- `checkIssued`: after handing out an `issued` token, while the token is on screen, and periodically in the background. Avoid overlapping runs: share one in-flight call instead of starting another.
- `Tokens.deleteSpent` (see [tokens.md](./tokens.md)) when the user wants spent rows gone.

## Inputs and outputs

`ValidationReport` (`validation/domain.ts`):

| Field              | Type                             | Notes                                                          |
| ------------------ | -------------------------------- | -------------------------------------------------------------- |
| `checkedRows`      | `Schema.Int`                     | rows the mints actually answered about                         |
| `markedSpent`      | `Schema.Array(SpentTokenReport)` | `{ rowId: TokenRowId, amount: Amount }` per row marked `error` |
| `mergedRows`       | `Schema.Array(TokenRowId)`       | siblings removed after merging                                 |
| `unavailableMints` | `Schema.Array(MintUrl)`          | rows left untouched                                            |

`RowCheckResult`: `rowId: TokenRowId`, `status: "live" | "spent" | "unavailable"`.

`IssuedClaimReport`: `claimed: Schema.Array(SpentTokenReport)`.

## Errors

| Tag                | Raised by  | When                | What to do         |
| ------------------ | ---------- | ------------------- | ------------------ |
| `TokenRowNotFound` | `checkRow` | no row with that id | drop the reference |

`checkAll` and `checkIssued` never fail. `checkAll` reports unreachable mints in `unavailableMints`. `checkIssued` leaves rows untouched when it cannot verify them and does not say so: an empty `claimed` array does not prove every mint answered.

## Related

- [tokens.md](./tokens.md) — `deleteSpent`, `returnToWallet`, lifecycle
- [send.md](./send.md) — `issued` rows come from here
- [melt.md](./melt.md) — where `reserved` rows come from
- [../README.md](../README.md) — "A missing NUT-07 answer is never a guess"
