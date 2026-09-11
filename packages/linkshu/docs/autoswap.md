# Autoswap

`Autoswap` moves a foreign mint's balance into your main mint: it quotes a topup at the target, pays that invoice by melting at the source, and mints at the target. Use it for the explicit "melt to main mint" action. When to trigger it is caller policy; the package never swaps on its own.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)) and a balance at `sourceMint` ([receive.md](./receive.md)); both mints must be Lightning-backed.

```ts
import { Effect } from "effect";
import { Autoswap, AutoswapDraft } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";

const consolidate = (sourceMint: MintUrl, targetMint: MintUrl) =>
  Effect.gen(function* () {
    const autoswap = yield* Autoswap;
    const receipt = yield* autoswap.claim(
      new AutoswapDraft({ sourceMint, targetMint }),
    );
    return receipt.movedAmount; // sat that arrived at the target
  });
```

At startup, and whenever connectivity returns, drain interrupted swaps:

```ts
const resumeSwaps = Effect.gen(function* () {
  const autoswap = yield* Autoswap;
  for (const result of yield* autoswap.resumePendingClaims) {
    switch (result.status) {
      case "claimed":
        console.log("moved", result.amount, "sat under", result.operationId);
        break;
      case "not-claimable-yet":
        // the melt may still be settling, or the target was unreachable;
        // the operation stays pending for the next resume
        break;
      case "dropped":
        console.log("gave up on", result.quoteId, "at", result.targetMint);
        break;
    }
  }
});
```

## How it works

1. **Size.** `available` proofs at the source are NUT-07 filtered (only confirmed `UNSPENT` proofs are eligible; spent ones are marked `spent`). The starting amount is the confirmed unspent balance minus the source's cashu input-fee allowance.
2. **Quote at the target** for that amount.
3. **Persist the claim** as a `pending` `autoswap` operation (`mint` is the target, `sourceMint` the source) before the invoice can be paid.
4. **Melt at the source** against the target's invoice through [`Melt`](./melt.md) — fee-inclusive swap, inputs `held` under a `melt` operation, change persisted.
5. **Wait for the target** to see the payment, then mint through the same claim machinery as [topup](./topup.md): the proofs are stored `available` before the operation closes `done`.

### How amounts step down

A melt `InsufficientFunds` costs only an unpaid quote, because the melt prices itself before touching a proof; that attempt's operation closes `failed`. The package retries automatically with up to four progressively smaller amounts to leave room for the Lightning fee reserve; if none fits, the last `InsufficientFunds` surfaces.

### When it is a no-op

- Nothing spendable at the source after the input-fee allowance → `InsufficientFunds` with `required = max(inputFee, 1)`; no quote is created.
- `resumePendingClaims` with no pending operations → empty array; it never fails.

### `resumePendingClaims`

For every `pending` autoswap, ask the target mint once:

| Mint says                                                         | Result `status`          | Operation                                                             |
| ----------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `PAID`/`ISSUED`, mint succeeds or reclaims                        | `claimed` (`amount` set) | `done`                                                                |
| `UNPAID` before the 24 h deadline                                 | `not-claimable-yet`      | kept `pending` — the melt may still be settling                       |
| `UNPAID` after the deadline, or `MintRejected` after the deadline | `dropped`                | `failed`                                                              |
| unreachable / any other failure                                   | `not-claimable-yet`      | kept `pending` — a mint that will not answer says nothing about funds |

Claims written by releases before the inventory (`linkshu.pendingAutoswapClaim.*` keys in the `KeyValueStore`) are carried over into `pending` autoswap operations the first time `resumePendingClaims` reads them, and the keys are removed.

## Inputs and outputs

`AutoswapDraft` (`autoswap/domain.ts`): `sourceMint: MintUrl`, `targetMint: MintUrl`.

`AutoswapReceipt`:

| Field         | Type                | Notes                                         |
| ------------- | ------------------- | --------------------------------------------- |
| `sourceMint`  | `MintUrl`           |                                               |
| `targetMint`  | `MintUrl`           |                                               |
| `movedAmount` | `Amount`            | what landed at the target, stored `available` |
| `feePaid`     | `NonNegativeAmount` | Lightning fee the source melt paid            |
| `operationId` | `OperationId`       | the `autoswap` operation, now `done`          |

`AutoswapClaimResult` (from `resumePendingClaims`):

| Field         | Type                                            |
| ------------- | ----------------------------------------------- |
| `quoteId`     | `QuoteId`                                       |
| `targetMint`  | `MintUrl`                                       |
| `status`      | `"claimed" \| "not-claimable-yet" \| "dropped"` |
| `operationId` | `OperationId`                                   |
| `amount`      | `Schema.NullOr(Amount)`                         |

## Errors

Every failure except `InsufficientFunds` leaves the autoswap `pending` on purpose: the source melt may already have paid the invoice. After any of them, run `resumePendingClaims` before calling `claim` again — a second `claim` would quote a new invoice while the first may still settle.

| Tag                  | When                                                                                                                  | What to do                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `InsufficientFunds`  | no sizing fit within four attempts, or nothing to move                                                                | leave the balance where it is                                                   |
| `PaymentFailed`      | the source melt failed or its quote expired, or the melt settled but the target still reports `UNPAID` after the poll | `resumePendingClaims` finishes it                                               |
| `PaymentPending`     | the source melt was sent but the source mint has not settled it                                                       | `Melt.resumePending` settles the source side, `resumePendingClaims` the target  |
| `MintUnreachable`    | either mint unreachable                                                                                               | `resumePendingClaims` when the mints answer; do not start a fresh `claim` first |
| `MintRejected`       | definitive rejection at either mint                                                                                   | surface `detail`; `resumePendingClaims` decides the operation's fate            |
| `CounterLockTimeout` | counter lease held elsewhere                                                                                          | `resumePendingClaims` later                                                     |

## Related

- [melt.md](./melt.md), [topup.md](./topup.md) — the two halves
- [mints.md](./mints.md) — `MintInfo.inputFeePpk`
- [errors.md](./errors.md)
