# Send

`Send` swaps an exact amount out of one mint's balance and hands you an encoded token. Use it to show a QR, share a link, or attach a token to a message. The token's row starts in the state you ask for and stays in the store until the recipient claims it or you return it.

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

1. **Select sources.** Every `accepted` row at `mint` (unit `sat`) is decoded. One batched NUT-07 check drops proofs the mint reports spent; a row whose every proof is spent is marked `error` (`TokenAlreadySpent`) right away — that knowledge sticks even if the send fails afterwards.
2. **Check funds.** `available < amount` fails with `InsufficientFunds` before any mint write.
3. **Swap.** Under the counter lock, `amount` is swapped out into fresh send proofs plus change proofs. Counter collisions are retried by the package, as in [receive.md](./receive.md).
4. **Persist change first.** The change proofs become a fresh `accepted` row (`send-change`).
5. **Persist the send row** in `produceAs` state, then remove the consumed source rows. Funds are never outside the store, even if the process dies mid-flow.

Only proofs explicitly reported `UNSPENT` are offered to the swap. `PENDING`, missing, and unrecognized states are excluded from its available amount. After a successful swap, unresolved proofs remain in their original rows; only the consumed part is removed. A failed swap leaves those rows intact. Stored balance can still include unresolved proofs until the mint resolves them.

### Choosing `produceAs`

| Value       | Use when                                                                             | Then                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `"issued"`  | the token is shown to someone (QR, share sheet)                                      | watch it with `Validation.checkIssued`; the row is pruned once the mint reports it fully spent (= claimed)   |
| `"pending"` | the token travels through a channel you confirm separately (chat message, HTTP POST) | on confirmed delivery drop the row with `TokenStore.remove`; on failed delivery call `Tokens.returnToWallet` |

Linky's QR/share flow uses `issued`; contact payments over Nostr and payment-request POSTs use `pending`.

For an HTTP POST payment request, use `receipt.proofs` in the JSON payload. These are the same proofs encoded in `receipt.tokenText`, with full keyset ids. Decoding v4 token text without the mint's keyset list fails for shortened v2 ids. Both fields contain spendable secrets; keep them out of logs and inspector events.

If delivery fails, check the result of `Tokens.returnToWallet`: recovery is attempted, not guaranteed. Successful recovery returns fresh proofs to the spendable balance; a transient failure preserves the pending row for a retry. Linky's POST flow currently displays the original payment error even if recovery also fails, so that error alone does not confirm the funds were returned. See [tokens.md](./tokens.md#returntowallet).

### Fees

Sends are exact-amount: the recipient receives `amount`. The mint's cashu input fee comes out of the change, so `receipt.feePaid = available - amount - changeAmount`. If the offered proofs cannot cover `amount` plus fees, the mint's own rejection is reported as `InsufficientFunds` (`required: amount`, `available`). There is no amount-degrade ladder in the package; the app decides whether to retry lower.

### When the recipient never claims

The `issued` row keeps the funds visible under "issued" but not in `balances`. To take them back, call `Tokens.returnToWallet(rowId)`: the encoding is re-received, so the copy the recipient holds dies at the mint. See [tokens.md](./tokens.md#returntowallet).

## Inputs and outputs

`SendDraft` (`send/domain.ts`):

| Field       | Type                                     | Notes                                         |
| ----------- | ---------------------------------------- | --------------------------------------------- |
| `mint`      | `MintUrl`                                | the mint to spend at; sends never cross mints |
| `amount`    | `Amount`                                 | positive integer sat                          |
| `memo`      | `Schema.optional(Schema.NonEmptyString)` | embedded in the token                         |
| `produceAs` | `"issued" \| "pending"`                  | starting state of the produced row            |

`SendReceipt`:

| Field          | Type                   | Notes                                                                        |
| -------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `rowId`        | `TokenRowId`           | the send row, in `produceAs` state                                           |
| `tokenText`    | `TokenText`            | v4 encoding to hand out                                                      |
| `proofs`       | `ReadonlyArray<Proof>` | the encoded proofs with full keyset ids; use directly for HTTP POST payloads |
| `mint`         | `MintUrl`              |                                                                              |
| `unit`         | `CurrencyUnit`         | always `sat`                                                                 |
| `amount`       | `Amount`               | equals the drafted amount                                                    |
| `changeAmount` | `NonNegativeAmount`    | persisted as a fresh `accepted` row before the receipt resolved              |
| `feePaid`      | `NonNegativeAmount`    | cashu input fee the swap cost                                                |

## Errors

On every failure, unspent sources remain available; rows the NUT-07 pre-check found fully spent have already been marked `error`, whatever happens next.

| Tag                  | When                                                                                                        | What to do                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `InsufficientFunds`  | balance at `mint` (after the NUT-07 filter) is below `amount`, or the swap could not cover amount plus fees | pick another mint (`Tokens.balances.perMint`) or a lower amount |
| `MintUnreachable`    | network/timeout/5xx while loading the mint, checking states, or swapping                                    | you may retry later                                             |
| `MintRejected`       | definitive rejection, malformed swap proofs, or collision retries exhausted                                 | surface `detail`                                                |
| `CounterLockTimeout` | the counter lease was held elsewhere                                                                        | you may retry                                                   |

## Related

- [tokens.md](./tokens.md) — `reserve`/`markIssued`/`markExternalized`, `returnToWallet`, balances
- [validation.md](./validation.md) — `checkIssued` prunes claimed sends
- [receive.md](./receive.md)
- [errors.md](./errors.md)
