# Validation

`Validation` asks mints about stored proofs (NUT-07). Its checks update rows accordingly; `inspectProofStates` returns amounts without changing rows. Use it to verify the balance, to check one token, and to notice when an issued token has been claimed. It performs no swap and costs no signatures.

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

### The calls

| Call                 | Rows considered               | Returns                                                                                         |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `checkAll`           | `accepted` only (the balance) | `ValidationReport`                                                                              |
| `checkRow(rowId)`    | the supplied row, any state   | `RowCheckResult`; `"unavailable"` when the mint gave no usable answer or the row states no mint |
| `checkIssued`        | `issued` only                 | `IssuedClaimReport`; fully spent rows are **removed** (the recipient claimed them)              |
| `inspectProofStates` | all stored rows               | `readonly TokenProofStateAmounts[]`; no row mutations                                           |

`inspectProofStates` batches requests by mint and unit and returns `{ rowId, unspent, pending, spent, unknown }` for each row. Amounts use the token's unit. A mixed token contributes to several amounts. Missing or unrecognized answers count as `unknown`; an unreachable mint leaves its rows' full amounts unknown. These are current mint answers, separate from the stored row's lifecycle state. The result contains no proof secrets or token text.

`checkAll` and `checkIssued` skip `pending` and `reserved` rows; `checkRow` checks whatever row you give it. Validation never resolves the `reserved` inputs of an interrupted melt — `checkRow` on one only reports what the mint says — [`Melt.resumePending`](./melt.md#resumepending--run-it-at-startup) settles them from the quote's state. `externalized` and dead `error` rows are only reported, never re-marked.

Validation never resurrects a row: an `error` row with live proofs comes back only through `Tokens.returnToWallet`.

### When to run it

- `checkAll`: on the user's "check all" action. Not on every render — each run is one request per mint.
- `checkRow`: when opening a token's detail page.
- `checkIssued`: after handing out an `issued` token, while the token is on screen, and periodically in the background. Avoid overlapping runs: share one in-flight call instead of starting another.
- `Tokens.deleteSpent` (see [tokens.md](./tokens.md)) when the user wants spent rows gone.
- `inspectProofStates`: when opening or refreshing a token list that shows available and pending amounts. Keep the snapshot in UI memory and discard it when rows change; do not persist mint answers as row states.

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
- [melt.md](./melt.md) — where `reserved` rows come from and who settles them
- [../README.md](../README.md) — "A missing NUT-07 answer is never a guess"
