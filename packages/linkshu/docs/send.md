# Send

`Send` swaps an exact amount out of one mint's balance and hands you an encoded token. The send proofs stay in the inventory as `handedOut` under a `send` operation until the recipient claims them or you return them.

## Example

```ts
import { Effect } from "effect";
import { Send, SendDraft } from "@linky-fit/linkshu";
import type { Amount, MintUrl } from "@linky-fit/linkshu";

const issueToken = (mint: MintUrl, amount: Amount) =>
  Effect.gen(function* () {
    const send = yield* Send;
    const receipt = yield* send.send(
      new SendDraft({ mint, amount, memo: "coffee", produceAs: "issued" }),
    );
    return receipt.tokenText; // show as QR / share
  });
```

Pick `mint` from `Tokens.balances.perMint`; sends never cross mints. Both `tokenText` and `proofs` on the receipt are spendable secrets; keep them out of logs.

## How it works

1. Check the amount. Whoever redeems the token pays the mint's input fee on its proofs (NUT-02). `amount` has to exceed that fee, else `AmountConsumedByFee` before any inventory change.
2. Select sources. Every `available` proof at `mint` goes into one NUT-07 check. Proofs reported `SPENT` are marked `spent` right away, whatever happens next. Only proofs reported `UNSPENT` are offered.
3. Check funds. Offered total below `amount` fails with `InsufficientFunds` before any mint write.
4. Swap under the counter lock into fresh send proofs plus change; collisions are retried as in [receive.md](./receive.md).
5. Persist the send: a `send` operation in the `produceAs` status with the token text, then the send proofs `handedOut` under it.
6. Persist change `available`, then mark the consumed inputs `spent`. Offered proofs the swap passed through untouched stay `available`. Funds are never outside the store, even if the process dies mid-flow.

### Choosing `produceAs`

| Value       | Use when                                                                        | Then                                                                                                        |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `"issued"`  | the token is shown to someone (QR, share sheet)                                 | watch it with `Validation.checkIssued`; the send closes `done` once the mint reports every proof spent      |
| `"pending"` | the token travels through a channel you confirm separately (message, HTTP POST) | on confirmed delivery `Tokens.forget(operationId)`; on failed delivery `Tokens.returnToWallet(operationId)` |

`Tokens.returnToWallet` re-receives the token, so the copy the recipient holds dies at the mint. Recovery is attempted, not guaranteed: a transient failure leaves the send for a retry ([tokens.md](./tokens.md#returntowallet)).

### Fees

Sends are exact-amount: the recipient receives `amount`. The mint's input fee comes out of the change, so `feePaid = offered - amount - changeAmount`. If the offered proofs cannot cover `amount` plus the fee, the mint's rejection is reported as `InsufficientFunds`. There is no amount step-down in the package; the caller decides whether to retry lower.

## Errors

On every failure the unspent sources stay `available`; proofs the pre-check found spent are already `spent`.

| Tag                   | When                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `InsufficientFunds`   | confirmed-unspent balance at `mint` is below `amount`, or the swap could not cover fees |
| `AmountConsumedByFee` | `amount` does not exceed the input fee the recipient pays to redeem the token           |

`MintUnreachable`, `MintRejected`, and `CounterLockTimeout` are in [errors.md](./errors.md).

## Related

- [tokens.md](./tokens.md): `markIssued`, `markExternalized`, `forget`, `returnToWallet`
- [validation.md](./validation.md): `checkIssued` closes claimed sends
