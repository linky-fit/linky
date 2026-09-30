# Autoswap

`Autoswap` moves funds from one mint to another: it quotes a topup at the target, pays that invoice by melting at the source, and mints at the target. Without an `amount` it sweeps the source's whole balance; with one it moves exactly that much, and `estimate` prices such a move first. When to trigger it is caller policy; the package never swaps on its own.

## Example

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
    const receipt = yield* autoswap.claim(draft);
    return receipt.movedAmount; // sat that arrived at the target
  });
```

Omit `amount` to sweep. At startup, and whenever connectivity returns, drain interrupted swaps:

```ts
const resumeSwaps = Effect.gen(function* () {
  const autoswap = yield* Autoswap;
  for (const result of yield* autoswap.resumePendingClaims) {
    // result.status: "claimed" | "not-claimable-yet" | "dropped"
    console.log(result.status, result.quoteId, result.amount);
  }
});
```

## How it works

1. Size. `available` proofs at the source are NUT-07 filtered; spent ones are marked `spent`. A sweep starts at the confirmed unspent balance minus the source's cashu input-fee allowance. An explicit `amount` plus that allowance must fit the confirmed balance, else `InsufficientFunds` before any quote is created.
2. Quote at the target for that amount.
3. Persist the claim as a `pending` `autoswap` operation (`mint` is the target, `sourceMint` the source) before the invoice can be paid.
4. Melt at the source against the target's invoice through [`Melt`](./melt.md): fee-inclusive swap, inputs `held` under a `melt` operation, change persisted.
5. Wait for the target to see the payment, then mint through the same claim machinery as [topup](./topup.md): proofs stored `available` before the operation closes `done`.

A melt `InsufficientFunds` costs only an unpaid quote, because the melt prices itself before touching a proof; that attempt's operation closes `failed`. A sweep retries with up to four progressively smaller amounts to leave room for the Lightning fee reserve; if none fits, the last `InsufficientFunds` surfaces. An explicit `amount` makes a single attempt.

### `estimate`

`estimate(draft)` prices a move without paying anything: a mint quote at the target, a melt quote for its invoice at the source, plus the input-fee allowance over the source's stored `available` proofs. Both quotes expire on their own; no proof changes state and no operation is written. `AutoswapEstimate.totalFromSource = amount + lightningFeeReserve + inputFee` is an upper bound: the melt returns unused fee reserve as change. `claim` does not reuse the estimate's quotes.

### `resumePendingClaims`

For every `pending` autoswap, ask the target mint once. The shared rules are in [concepts.md](./concepts.md#resuming-interrupted-operations).

| Mint says                                     | `status`                 | Operation                                      |
| --------------------------------------------- | ------------------------ | ---------------------------------------------- |
| `PAID`/`ISSUED`, mint succeeds or reclaims    | `claimed` (`amount` set) | `done`                                         |
| `UNPAID` before the 24 h deadline             | `not-claimable-yet`      | kept `pending`; the melt may still be settling |
| `UNPAID` or `MintRejected` after the deadline | `dropped`                | `failed`                                       |
| unreachable / any other failure               | `not-claimable-yet`      | kept `pending`                                 |

## Errors

Every `claim` failure except `InsufficientFunds` leaves the autoswap `pending` on purpose: the source melt may already have paid the invoice. Run `resumePendingClaims` before calling `claim` again, or a second `claim` quotes a new invoice while the first may still settle.

| Tag                 | When                                                                                                                  | What to do                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `InsufficientFunds` | no sizing fit within four attempts, nothing to move, or an explicit `amount` plus fees above the balance              | ask for a smaller amount                                                       |
| `PaymentFailed`     | the source melt failed or its quote expired, or the melt settled but the target still reports `UNPAID` after the poll | `resumePendingClaims` finishes it                                              |
| `PaymentPending`    | the source melt was sent but the source mint has not settled it                                                       | `Melt.resumePending` settles the source side, `resumePendingClaims` the target |

`MintUnreachable`, `MintRejected`, and `CounterLockTimeout` are in [errors.md](./errors.md); after any of them, `resumePendingClaims` decides the operation's fate. `estimate` fails only with `InsufficientFunds`, `MintUnreachable`, or `MintRejected` and never leaves an operation behind.

## Related

- [melt.md](./melt.md), [topup.md](./topup.md): the two halves
- [mints.md](./mints.md): `MintInfo.inputFeePpk`
