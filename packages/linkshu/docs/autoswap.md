# Autoswap

`Autoswap` moves funds from one mint to another: it quotes a topup at the target, pays that invoice by melting at the source, and mints at the target. Without an amount it sweeps the source's whole balance (Linky's "melt to main mint" action); with one it moves exactly that much (Linky's "move funds" form), and `estimate` prices such a move first. When to trigger it is caller policy; the package never swaps on its own.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)) and a balance at `sourceMint` ([receive.md](./receive.md)); both mints must be Lightning-backed.

```ts
import { Effect } from "effect";
import { Autoswap, AutoswapDraft } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";

const consolidate = (sourceMint: MintUrl, targetMint: MintUrl) =>
  Effect.gen(function* () {
    const autoswap = yield* Autoswap;
    const receipt = yield* autoswap.claim(
      new AutoswapDraft({ sourceMint, targetMint }),
    );
    return receipt.movedAmount; // sat that arrived at the target
  });
```

To move a fixed amount, price it first and show the user the total, then claim with the same draft:

```ts
import { Effect } from "effect";
import { Amount, Autoswap, AutoswapDraft } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";

const moveAmount = (sourceMint: MintUrl, targetMint: MintUrl, sat: number) =>
  Effect.gen(function* () {
    const autoswap = yield* Autoswap;
    const draft = new AutoswapDraft({
      sourceMint,
      targetMint,
      amount: Amount.make(sat),
    });
    const estimate = yield* autoswap.estimate(draft);
    console.log("at most", estimate.totalFromSource, "sat leaves the source");
    return yield* autoswap.claim(draft);
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

1. **Size.** `available` proofs at the source are NUT-07 filtered (only confirmed `UNSPENT` proofs are eligible; spent ones are marked `spent`). A sweep starts at the confirmed unspent balance minus the source's cashu input-fee allowance. An explicit `amount` is used as is; when `amount` plus the input-fee allowance exceeds the confirmed balance, `claim` fails with `InsufficientFunds` (`required = amount + inputFee`) before any quote is created.
2. **Quote at the target** for that amount.
3. **Persist the claim** as a `pending` `autoswap` operation (`mint` is the target, `sourceMint` the source) before the invoice can be paid.
4. **Melt at the source** against the target's invoice through [`Melt`](./melt.md) — fee-inclusive swap, inputs `held` under a `melt` operation, change persisted.
5. **Wait for the target** to see the payment, then mint through the same claim machinery as [topup](./topup.md): the proofs are stored `available` before the operation closes `done`.

### How amounts step down

A melt `InsufficientFunds` costs only an unpaid quote, because the melt prices itself before touching a proof; that attempt's operation closes `failed`. A sweep retries automatically with up to four progressively smaller amounts to leave room for the Lightning fee reserve; if none fits, the last `InsufficientFunds` surfaces.

A draft with an explicit `amount` makes a single attempt: the melt's `InsufficientFunds` (with the fee reserve in `required`) surfaces as is, and the attempt's operation closes `failed`.

### When it is a no-op

- Nothing spendable at the source after the input-fee allowance → `InsufficientFunds` with `required = max(inputFee, 1)`; no quote is created.
- `resumePendingClaims` with no pending operations → empty array; it never fails.

### `estimate`

`estimate(draft)` prices a move without paying anything: it creates a mint quote at the target for `amount`, asks the source for a melt quote on that invoice, and adds the source's cashu input-fee allowance over its stored `available` proofs. Both quotes are left unpaid and expire on their own. It reads proofs without a NUT-07 check, so no proof changes state, and it writes no operation. Without an `amount` it prices the sweep's first attempt (the balance minus the input fee), which the Lightning fee reserve then exceeds; the sweep's step-down handles that.

Every number is an upper bound: the melt returns unused fee reserve as change, and the input fee is charged on the proofs the swap actually selects. `claim` does not reuse the estimate's quotes. The package reports it as the `autoswap.estimate` operation.

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

`AutoswapDraft` (`autoswap/domain.ts`):

| Field        | Type                      | Notes                                                                                                 |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sourceMint` | `MintUrl`                 |                                                                                                       |
| `targetMint` | `MintUrl`                 |                                                                                                       |
| `amount`     | `Schema.optional(Amount)` | what the target issues; the source pays it plus fees. Omitted: sweep the whole balance, stepping down |

`AutoswapEstimate` (from `estimate`):

| Field                 | Type                | Notes                                                  |
| --------------------- | ------------------- | ------------------------------------------------------ |
| `sourceMint`          | `MintUrl`           |                                                        |
| `targetMint`          | `MintUrl`           |                                                        |
| `amount`              | `Amount`            | what the target would issue                            |
| `lightningFeeReserve` | `NonNegativeAmount` | the source's melt quote fee reserve                    |
| `inputFee`            | `NonNegativeAmount` | cashu input-fee allowance over the source's proofs     |
| `totalFromSource`     | `Amount`            | `amount + lightningFeeReserve + inputFee`, upper bound |

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
| `InsufficientFunds`  | no sizing fit within four attempts, nothing to move, or an explicit `amount` (plus fees) above the balance            | leave the balance where it is, or ask for a smaller amount                      |
| `PaymentFailed`      | the source melt failed or its quote expired, or the melt settled but the target still reports `UNPAID` after the poll | `resumePendingClaims` finishes it                                               |
| `PaymentPending`     | the source melt was sent but the source mint has not settled it                                                       | `Melt.resumePending` settles the source side, `resumePendingClaims` the target  |
| `MintUnreachable`    | either mint unreachable                                                                                               | `resumePendingClaims` when the mints answer; do not start a fresh `claim` first |
| `MintRejected`       | definitive rejection at either mint                                                                                   | surface `detail`; `resumePendingClaims` decides the operation's fate            |
| `CounterLockTimeout` | counter lease held elsewhere                                                                                          | `resumePendingClaims` later                                                     |

`estimate` fails only with the tags below and never leaves an operation behind:

| Tag                 | When                                                                                 | What to do                  |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `InsufficientFunds` | `amount` plus the input-fee allowance exceeds the stored balance, or nothing to move | ask for a smaller amount    |
| `MintUnreachable`   | either mint unreachable                                                              | show "unknown"; retry later |
| `MintRejected`      | either mint rejected a quote                                                         | surface `detail`            |

## Related

- [melt.md](./melt.md), [topup.md](./topup.md) — the two halves
- [mints.md](./mints.md) — `MintInfo.inputFeePpk`
- [errors.md](./errors.md)
