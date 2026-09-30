# Validation

`Validation` asks mints about stored proofs (NUT-07) and updates proof states from the answers; `inspectProofStates` reports without changing anything. It performs no swap and costs no signatures.

## Example

```ts
import { Effect } from "effect";
import { Validation } from "@linky-fit/linkshu";

const checkWallet = Effect.gen(function* () {
  const validation = yield* Validation;
  const report = yield* validation.checkAll;
  return {
    spent: report.markedSpent.length,
    released: report.released,
    offline: report.unavailableMints,
  };
});
```

## How it works

One batched checkstate call per mint and unit. Per proof:

| Mint's answer                                        | What happens                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SPENT`                                              | proof → `spent` (its `operationId` link is kept as history); listed in `markedSpent` |
| `UNSPENT`, and the proof is `held` with no operation | proof → `available`: a migrated row whose melt is unknown is back in balance         |
| `UNSPENT` otherwise                                  | nothing changes                                                                      |
| `PENDING` / unanswered / unrecognized                | nothing changes; a missing answer is never a guess                                   |
| mint unreachable or rejects the query                | whole group untouched; mint listed in `unavailableMints`                             |

### The calls

| Call                         | Proofs considered                                                   | Returns                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `checkAll`                   | `available`, plus `held` with `operationId === null`                | `ValidationReport`                                                                                            |
| `checkTransfer(operationId)` | a `send`'s `handedOut`/`externalized` proofs, or a `receive`'s text | `TransferCheckResult`; `"unavailable"` when the mint gave no usable answer                                    |
| `checkIssued`                | `handedOut` and `externalized`                                      | `IssuedClaimReport`; a send whose every handed-out proof is spent is closed `done` (the recipient claimed it) |
| `inspectProofStates`         | every proof that is not `spent`                                     | `ProofStateSnapshot[]`; no writes                                                                             |

`checkTransfer` on a `send` marks the spent proofs and reports `spent` when all are (closing the send `done`), `live` when every proof was answered and some are unspent, `unavailable` otherwise. A send with no handed-out proofs left reports `spent` when it is `done` or `returned`. On a `receive` it asks about the proofs in the stored text without writing anything (they are not the wallet's until accepted) and reports `spent` only when every one is. A quote operation's id fails with `OperationNotFound`.

`inspectProofStates` returns `{ proofId, state }` per proof, `state` being `unspent`, `pending`, `spent`, or `unknown` (missing answer or unreachable mint). These are current mint answers, separate from the stored `state`, and contain no secrets.

Proofs `held` by a known melt belong to [`Melt.resumePending`](./melt.md#resumepending); validation never touches them. Validation never deletes a proof and never reopens a closed operation.

### When to run it

- `checkAll`: on an explicit "check all" action, not on every render; each run is one request per mint.
- `checkTransfer`: when opening a transfer's detail view.
- `checkIssued`: while an `issued` token is on screen, and periodically in the background. Share one in-flight call instead of overlapping runs.
- `inspectProofStates`: when opening or refreshing a list that shows available and pending amounts. Keep the snapshot in UI memory; do not persist mint answers as states.

## Errors

`checkTransfer` fails with `OperationNotFound` for an id that is not a transfer. `checkAll`, `checkIssued`, and `inspectProofStates` never fail: `checkAll` lists unreachable mints in `unavailableMints`; `checkIssued` leaves proofs it cannot verify untouched and does not say so, so an empty `claimed` array does not prove every mint answered.

## Related

- [tokens.md](./tokens.md): `returnToWallet`, `forget`, transfers
- [send.md](./send.md): where handed-out proofs come from
- [concepts.md](./concepts.md#error-classification): a missing NUT-07 answer is never a guess
