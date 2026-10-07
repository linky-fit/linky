# Melt

`Melt` pays a bolt11 invoice from one mint's balance. Quote first, show the most the payment can cost, then melt with the same invoice, the quote id and that maximum.

## Example

```ts
import { Effect } from "effect";
import { Melt, MeltDraft } from "@linky-fit/linkshu";
import type {
  Amount,
  Bolt11Invoice,
  MeltQuote,
  MintUrl,
} from "@linky-fit/linkshu";

// Step 1: price it. Touches no proof; show `cost.maxTotal` to the user.
const priceInvoice = (mint: MintUrl, invoice: Bolt11Invoice) =>
  Effect.gen(function* () {
    const melt = yield* Melt;
    return yield* melt.cost(
      yield* melt.quote(new MeltDraft({ mint, invoice })),
    );
  });

// Step 2: once the user confirms, pay the priced quote, never above the confirmed total.
const payQuoted = (
  invoice: Bolt11Invoice,
  quote: MeltQuote,
  maxTotal: Amount,
) =>
  Effect.gen(function* () {
    const melt = yield* Melt;
    return yield* melt.melt(
      new MeltDraft({
        mint: quote.mint,
        invoice,
        quoteId: quote.quoteId,
        maxTotal,
      }),
    );
  });
```

`cost(quote)` returns a `MeltCost`: `maxTotal = amount + feeReserve + inputFee`, where `inputFee` is the cashu input fee (NUT-02) of the melt inputs plus that of the swap that cuts them out of the balance, counted over every `available` proof at the mint. It reads the stored proofs without a NUT-07 check, so no proof changes state. With `maxTotal` on the draft, `melt` picks the swap's proofs first and fails with `PaymentFailed` before anything moves when that swap and its inputs would cost more, which happens when the balance changed since the cost was read.

The receipt carries `paidAmount`, `feeReserve`, `feePaid` (what the melt inputs lost beyond invoice and change: the Lightning fee and their input fee, may be 0), `swapFee` (the funding swap's input fee; 0 for a melt `resumePending` settled, which does not record it) and `changeAmount` (returned as fresh `available` proofs). The balance went down by `paidAmount + feePaid + swapFee`. Omitting `quoteId` makes `melt` request a fresh quote. `status(quote)` re-reads a quote's state (`"UNPAID" | "PENDING" | "PAID" | null`) without side effects.

## How it works

`quote` costs nothing and touches no proof. `melt` runs in this order:

1. Price. Fetch or re-check the quote; it must be `UNPAID` (else `PaymentFailed`, nothing sent) and not past `expiresAt` (else `QuoteExpired`).
2. Select sources. `available` proofs at `mint`, NUT-07 filtered; spent ones are marked `spent`. The confirmed unspent total must cover `amount + feeReserve`, else `InsufficientFunds`.
3. Swap fee-inclusive. Exactly `amount + feeReserve` plus the swap's own input fee is swapped out under the counter lock.
4. Persist before melting. A `pending` `melt` operation (quote, invoice, amounts, `inputsTotal`) is inserted; the melt inputs are stored `held` under it; the remainder is stored `available`; then the consumed sources are marked `spent`. From here on the payment is reconstructible from the stores alone.
5. Melt and settle. Each attempt writes its blank-output slot to the operation's `counter` and advances the deterministic counter past the full NUT-08 blank range before the request leaves.

| Mint answer             | Result                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAID`                  | change stored `available`, held inputs `spent`, melt `paid`; receipt resolves                                                               |
| `UNPAID`                | held inputs back to `available`, melt `unpaid`; `PaymentFailed`                                                                             |
| `PENDING`               | polled briefly; then `PAID`/`UNPAID` as above, or `PaymentPending` with the inputs still `held` under the `pending` melt                    |
| response lost (network) | the quote is checked once; `PAID`/`UNPAID` as above, no answer → `PaymentPending`, inputs still `held`. Never surfaces as `MintUnreachable` |
| definitive rejection    | held inputs back to `available`, melt `failed` with the serialized `MintRejected`; `MintRejected`                                           |

### `resumePending`

A `PaymentPending` failure, or a crash after step 4, leaves a `pending` melt with `held` inputs. `resumePending` asks the mint about each one and returns a `MeltResumeResult` per melt. The shared rules (when to run it, why only the mint's answer retires a record) are in [concepts.md](./concepts.md#resuming-interrupted-operations).

| Mint answer      | `status`     | What happened                                                                                                     |
| ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `PAID`           | `paid`       | change reclaimed via NUT-09 over the recorded blank slot and stored `available`; inputs `spent`; `receipt` is set |
| `UNPAID`         | `unpaid`     | inputs back to `available`; melt `unpaid`                                                                         |
| `PENDING`        | `pending`    | inputs and melt untouched                                                                                         |
| no usable answer | `unresolved` | inputs and melt untouched; the mint could not be loaded, did not answer, or rejected the change reclaim           |

```ts
import { Effect } from "effect";
import { Melt } from "@linky-fit/linkshu";

const settleInterruptedMelts = Effect.gen(function* () {
  const melt = yield* Melt;
  for (const result of yield* melt.resumePending) {
    console.log(result.status, result.quoteId, result.receipt?.feePaid);
  }
});
```

An input can sync in from another device after its melt closed here (a melt operation synced ahead of its proof rows). Each `resumePending` also settles such inputs by the melt's outcome, with reason `melt-late-input`: `spent` under a `paid` melt, else back to the melt's envelope or to the balance.

Do not pay the invoice again while a melt is pending: `melt` with the same `quoteId` fails with `PaymentFailed` while the quote is not `UNPAID`. `held` inputs are not a transfer; `Tokens.returnToWallet` cannot release them, only the mint's answer through `resumePending` does.

## Paying from an envelope

`meltEnvelope(draft)` pays an invoice with an open envelope's proofs ([envelope.md](./envelope.md)). The invoice must ask for exactly the envelope's amount, else `PaymentFailed` before anything moves. `available` proofs at the same mint cover only the fee reserve and the input fees: that much is swapped out fee-inclusive as for `melt`, nothing when both are zero.

```ts
import { Effect } from "effect";
import { EnvelopeMeltDraft, Melt } from "@linky-fit/linkshu";
import type { Bolt11Invoice, EnvelopeKey, MintUrl } from "@linky-fit/linkshu";

const payFromEnvelope = (
  mint: MintUrl,
  key: EnvelopeKey,
  invoice: Bolt11Invoice,
) =>
  Effect.gen(function* () {
    const melt = yield* Melt;
    return yield* melt.meltEnvelope(
      new EnvelopeMeltDraft({ mint, key, invoice }),
    );
  });
```

The envelope's proofs move `held` under the `melt` operation with the other inputs, and the melt operation keeps the envelope's token text, so whichever device settles the melt knows which inputs are the envelope's. The melt runs and resumes as above. When the mint answers `PAID` the envelope closes `done`; when the melt ends `unpaid` or `failed`, the envelope's proofs go back `held` under the envelope (whose operation is stored first if it has not synced to this device) and only the other inputs return to the balance, so the next attempt pays from the same envelope. Two wallets melting one envelope for different invoices end the same way: the mint pays one melt and rejects the other's spent inputs, the loser's envelope proofs go back under its envelope, and its next `Envelope.state` reads `spent`. It fails with `EnvelopeNotFound` when the envelope is not open here and with `EnvelopeBusy` when another context holds its lease.

## Errors

| Tag              | Kind       | When                                                                       | Balance                                                                          |
| ---------------- | ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `QuoteExpired`   | definitive | quote past `expiresAt`                                                     | intact; request a new quote                                                      |
| `PaymentFailed`  | definitive | mint reported `UNPAID`, or the quote was not `UNPAID` when melting started | inputs back in balance; pay again with a new quote                               |
| `PaymentPending` | pending    | the melt was sent and the mint has not settled it                          | inputs `held` under the `pending` melt `operationId`; `resumePending` settles it |

`InsufficientFunds` (`required` carries `amount + feeReserve`), `MintRejected`, `MintUnreachable`, and `CounterLockTimeout` are in [errors.md](./errors.md). A `MintUnreachable` from `melt` means the request never left: no melt operation exists and the balance is intact.

## Related

- [mints.md](./mints.md#lightning-fee-probe): estimate the Lightning fee before there is an invoice
- [lightning-utilities.md](./lightning-utilities.md): invoice preview, LNURL invoice fetch
- [topup.md](./topup.md): the same resume pattern for incoming Lightning
