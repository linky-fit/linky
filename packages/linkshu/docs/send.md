# Send

`Send` swaps an exact amount out of one mint's balance and hands you an encoded token. Use it to show a QR, share a link, or attach a token to a message. The send proofs stay in the inventory as `handedOut` under a `send` operation in the status you ask for, until the recipient claims them or you return them.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)) and a funded balance at `mint` ([receive.md](./receive.md) or [topup.md](./topup.md)); pick the mint from `Tokens.balances.perMint`.

```ts
import { Effect } from "effect";
import { Send, SendDraft } from "@linky/linkshu";
import type { Amount, MintUrl } from "@linky/linkshu";

const issueToken = (mint: MintUrl, amount: Amount) =>
  Effect.gen(function* () {
    const send = yield* Send;
    const receipt = yield* send.send(
      new SendDraft({ mint, amount, memo: "coffee", produceAs: "issued" }),
    );
    return receipt.tokenText; // show as QR / share
  });
```

Run it with `runLinkshu` or on your `ManagedRuntime`.

## How it works

1. **Select sources.** Every `available` proof at `mint` (unit `sat`) goes into one batched NUT-07 check. Proofs the mint reports `SPENT` are marked `spent` right away — that knowledge sticks even if the send fails afterwards. Only proofs explicitly reported `UNSPENT` are offered; `PENDING`, missing, and unrecognized states stay `available` but are not offered and do not count.
2. **Check funds.** Offered total below `amount` fails with `InsufficientFunds` before any mint write.
3. **Swap.** Under the counter lock, `amount` is swapped out into fresh send proofs plus change. Counter collisions are retried by the package, as in [receive.md](./receive.md).
4. **Persist the send.** A `send` operation in the `produceAs` status is inserted with the token text, then the send proofs are stored `handedOut` under it.
5. **Persist change, then retire inputs.** Fresh change is stored `available` (`send-change`); only then are the consumed inputs marked `spent`. Offered proofs the swap passed through untouched stay `available`. Funds are never outside the store, even if the process dies mid-flow.

### Choosing `produceAs`

| Value       | Use when                                                                             | Then                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `"issued"`  | the token is shown to someone (QR, share sheet)                                      | watch it with `Validation.checkIssued`; the send closes `done` once the mint reports every proof spent (= claimed) |
| `"pending"` | the token travels through a channel you confirm separately (chat message, HTTP POST) | on confirmed delivery `Tokens.forget(operationId)`; on failed delivery `Tokens.returnToWallet(operationId)`        |

Linky's QR/share flow uses `issued`; contact payments over Nostr and payment-request POSTs use `pending`.

For an HTTP POST payment request, use `receipt.proofs` in the JSON payload. These are the same proofs encoded in `receipt.tokenText`, with full keyset ids. Decoding v4 token text without the mint's keyset list fails for shortened v2 ids. Both fields contain spendable secrets; keep them out of logs and inspector events.

If delivery fails, check the result of `Tokens.returnToWallet`: recovery is attempted, not guaranteed. Successful recovery returns fresh proofs to the spendable balance and closes the send as `returned`; a transient failure leaves the pending send for a retry. Linky's POST flow currently displays the original payment error even if recovery also fails, so that error alone does not confirm the funds were returned. See [tokens.md](./tokens.md#returntowallet).

### Fees

Sends are exact-amount: the recipient receives `amount`. The mint's cashu input fee comes out of the change, so `receipt.feePaid = offered - amount - changeAmount`. If the offered proofs cannot cover `amount` plus fees, the mint's own rejection is reported as `InsufficientFunds` (`required: amount`, `available`). There is no amount-degrade ladder in the package; the app decides whether to retry lower.

### When the recipient never claims

The `issued` send keeps the funds visible under `Tokens.transfers` but not in `balances`. To take them back, call `Tokens.returnToWallet(operationId)`: the encoding is re-received, so the copy the recipient holds dies at the mint. See [tokens.md](./tokens.md#returntowallet).

## Inputs and outputs

`SendDraft` (`send/domain.ts`):

| Field       | Type                                     | Notes                                         |
| ----------- | ---------------------------------------- | --------------------------------------------- |
| `mint`      | `MintUrl`                                | the mint to spend at; sends never cross mints |
| `amount`    | `Amount`                                 | positive integer sat                          |
| `memo`      | `Schema.optional(Schema.NonEmptyString)` | embedded in the token                         |
| `produceAs` | `"issued" \| "pending"`                  | starting status of the produced send          |

`SendReceipt`:

| Field          | Type                   | Notes                                                                        |
| -------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `operationId`  | `OperationId`          | the `send`, in the `produceAs` status                                        |
| `tokenText`    | `TokenText`            | v4 encoding to hand out                                                      |
| `proofs`       | `ReadonlyArray<Proof>` | the encoded proofs with full keyset ids; use directly for HTTP POST payloads |
| `mint`         | `MintUrl`              |                                                                              |
| `unit`         | `CurrencyUnit`         | always `sat`                                                                 |
| `amount`       | `Amount`               | equals the drafted amount                                                    |
| `changeAmount` | `NonNegativeAmount`    | kept after the swap; fresh change is `available` before the receipt resolved |
| `feePaid`      | `NonNegativeAmount`    | cashu input fee the swap cost                                                |

## Errors

On every failure, unspent sources remain `available`; proofs the NUT-07 pre-check found spent have already been marked `spent`, whatever happens next.

| Tag                  | When                                                                                                | What to do                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `InsufficientFunds`  | confirmed-unspent balance at `mint` is below `amount`, or the swap could not cover amount plus fees | pick another mint (`Tokens.balances.perMint`) or a lower amount |
| `MintUnreachable`    | network/timeout/5xx while loading the mint, checking states, or swapping                            | you may retry later                                             |
| `MintRejected`       | definitive rejection, malformed swap proofs, or collision retries exhausted                         | surface `detail`                                                |
| `CounterLockTimeout` | the counter lease was held elsewhere                                                                | you may retry                                                   |

## Related

- [tokens.md](./tokens.md) — `markIssued`/`markExternalized`/`forget`, `returnToWallet`, balances
- [validation.md](./validation.md) — `checkIssued` closes claimed sends
- [receive.md](./receive.md)
- [errors.md](./errors.md)
