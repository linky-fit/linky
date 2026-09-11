# Validation

`Validation` asks mints about stored proofs (NUT-07). Its checks update proof states accordingly; `inspectProofStates` reports without changing anything. Use it to verify the balance, to check one transfer, and to notice when a handed-out token has been claimed. It performs no swap and costs no signatures.

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
    released: report.released,
    offline: report.unavailableMints,
  };
});
```

## How it works

One batched checkstate call per mint+unit group. Per proof:

| Mint's answer for the proof                          | What happens                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SPENT`                                              | proof → `spent` (its `operationId` link is kept as history); reported in `markedSpent`   |
| `UNSPENT`, and the proof is `held` with no operation | proof → `available` — a migrated `reserved` row whose melt is unknown is back in balance |
| `UNSPENT` otherwise                                  | nothing changes                                                                          |
| `PENDING` / unanswered / unrecognized / truncated    | nothing changes — a missing answer is never a guess                                      |
| mint unreachable or rejects the query                | whole group untouched; mint listed in `unavailableMints`                                 |

### The calls

| Call                         | Proofs considered                                                   | Returns                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `checkAll`                   | `available`, plus `held` with `operationId === null`                | `ValidationReport`                                                                                            |
| `checkTransfer(operationId)` | a `send`'s `handedOut`/`externalized` proofs, or a `receive`'s text | `TransferCheckResult`; `"unavailable"` when the mint gave no usable answer for every proof                    |
| `checkIssued`                | `handedOut` and `externalized`                                      | `IssuedClaimReport`; a send whose every handed-out proof is spent is closed `done` (the recipient claimed it) |
| `inspectProofStates`         | every proof that is not `spent`                                     | `readonly ProofStateSnapshot[]`; no writes                                                                    |

`checkTransfer` on a `send` asks the mint about the proofs it handed out, marks the spent ones, and reports `spent` when all are (closing the send `done`), `live` when every proof was answered and some are unspent, `unavailable` otherwise. A send with no handed-out proofs left reports `spent` when it is `done` or `returned`, `unavailable` otherwise. On a `receive` it decodes the stored text and asks the mint about those proofs without writing anything — they are not the wallet's until accepted — and reports `spent` only when every one is. `checkTransfer` on a quote operation fails with `OperationNotFound`.

`inspectProofStates` batches by mint and unit and returns `{ proofId, state }` per proof, `state` being `unspent`, `pending`, `spent`, or `unknown`. Missing or unrecognized answers are `unknown`; an unreachable mint leaves its proofs `unknown`. These are current mint answers, separate from the stored `state`. The result contains no secrets.

Proofs `held` by a known melt belong to [`Melt.resumePending`](./melt.md#resumepending--run-it-at-startup), which settles them from the quote's state; validation never touches them. Validation never deletes a proof and never reopens a closed operation.

### When to run it

- `checkAll`: on the user's "check all" action. Not on every render — each run is one request per mint.
- `checkTransfer`: when opening a transfer's detail page.
- `checkIssued`: after handing out an `issued` token, while the token is on screen, and periodically in the background. Avoid overlapping runs: share one in-flight call instead of starting another.
- `inspectProofStates`: when opening or refreshing a list that shows available and pending amounts. Keep the snapshot in UI memory and discard it when the inventory changes; do not persist mint answers as states.

## Inputs and outputs

`ValidationReport` (`validation/domain.ts`):

| Field              | Type                             | Notes                                                             |
| ------------------ | -------------------------------- | ----------------------------------------------------------------- |
| `checkedProofs`    | `Schema.Int`                     | proofs the mints actually answered about                          |
| `markedSpent`      | `Schema.Array(SpentProofReport)` | `{ proofId: ProofId, amount: Amount }` per proof marked `spent`   |
| `released`         | `Schema.Int`                     | held-by-unknown proofs the mint reported unspent, now `available` |
| `unavailableMints` | `Schema.Array(MintUrl)`          | proofs left untouched                                             |

`TransferCheckResult`: `operationId: OperationId`, `status: "live" | "spent" | "unavailable"`.

`IssuedClaimReport`: `claimed: Schema.Array(ClaimedTransferReport)` with `ClaimedTransferReport { operationId: OperationId, amount: Amount }` — the amount handed out by each send closed as claimed.

`ProofStateSnapshot`: `proofId: ProofId`, `state: "unspent" | "pending" | "spent" | "unknown"`.

## Errors

| Tag                 | Raised by       | When                                                     | What to do         |
| ------------------- | --------------- | -------------------------------------------------------- | ------------------ |
| `OperationNotFound` | `checkTransfer` | no transfer with that id (quote operations do not count) | drop the reference |

`checkAll`, `checkIssued`, and `inspectProofStates` never fail. `checkAll` reports unreachable mints in `unavailableMints`. `checkIssued` leaves proofs untouched when it cannot verify them and does not say so: an empty `claimed` array does not prove every mint answered.

## Related

- [tokens.md](./tokens.md) — `returnToWallet`, `forget`, transfers
- [send.md](./send.md) — handed-out proofs come from here
- [melt.md](./melt.md) — where `held` proofs come from and who settles them
- [../README.md](../README.md) — "A missing NUT-07 answer is never a guess"
