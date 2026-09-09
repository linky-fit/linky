# Melt

`Melt` pays a bolt11 invoice from one mint's balance. Use it for "pay invoice" and for the invoice you fetched from an LNURL/lightning address. Quote first to show the price, then melt with the same invoice and the quote id.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)) and a balance at `mint` covering the invoice plus fee reserve ([receive.md](./receive.md) or [topup.md](./topup.md)). Get the invoice from the user or from [lightning-utilities.md](./lightning-utilities.md).

```ts
import { Effect } from "effect";
import { Melt, MeltDraft } from "@linky/linkshu";
import type { Bolt11Invoice, MeltQuote, MintUrl } from "@linky/linkshu";

// Step 1: price it. Touches no row; show `amount + feeReserve` to the user.
const priceInvoice = (mint: MintUrl, invoice: Bolt11Invoice) =>
  Effect.gen(function* () {
    const melt = yield* Melt;
    return yield* melt.quote(new MeltDraft({ mint, invoice }));
  });

// Step 2: once the user confirms, pay the priced quote.
const payQuoted = (invoice: Bolt11Invoice, quote: MeltQuote) =>
  Effect.gen(function* () {
    const melt = yield* Melt;
    return yield* melt.melt(
      new MeltDraft({ mint: quote.mint, invoice, quoteId: quote.quoteId }),
    );
  });
```

The receipt carries `paidAmount`, `feePaid`, and `changeAmount`. Passing `quoteId` reuses the priced quote; omitting it makes `melt` request a fresh one (the CLI's `melt <invoice>` does that, `apps/linkshu-cli/src/commands.ts`). Keep the `MeltQuote` until the receipt arrives: it is what you need to recover an interrupted payment.

## How it works

`quote` costs nothing and touches no row. `melt` does the following, in order:

1. **Price.** Fetch (or re-check) the melt quote. It must be `UNPAID` and not past `expiresAt`.
2. **Select sources.** `accepted` rows at `mint`, NUT-07 filtered; fully spent rows are marked `error`. Needs `amount + feeReserve`, else `InsufficientFunds`.
3. **Swap fee-inclusive.** Exactly `amount + feeReserve` (plus its own cashu input fee) is swapped out under the counter lock.
4. **Persist before melting.** The remainder becomes an `accepted` row (`melt-keep`); the melt inputs become a `reserved` row; the consumed source rows are removed. Funds are never outside the store.
5. **Melt and settle.**

| Mint answer                       | Result                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PAID`                            | change proofs become an `accepted` row (`melt-change`); the `reserved` row is removed; receipt resolves             |
| `UNPAID`                          | the `reserved` row flips back to `accepted`; `PaymentFailed`                                                        |
| `PENDING`                         | polled briefly; `PAID`/`UNPAID` as above, still pending → `PaymentFailed` and the inputs **stay `reserved`**        |
| response lost (`MintUnreachable`) | the quote is checked once; `PAID` finishes normally, otherwise `MintUnreachable` and the inputs **stay `reserved`** |
| definitive rejection              | the `reserved` row flips back to `accepted`; `MintRejected`                                                         |

`status(quote)` re-reads a quote's state (`"UNPAID" | "PENDING" | "PAID" | null`) without side effects.

Only proofs explicitly reported `UNSPENT` are offered to the swap. `PENDING`, missing, and unrecognized states are excluded from its available amount. After a successful swap, unresolved proofs remain in their original rows; only the consumed part is removed. A failed swap leaves those rows intact. Stored balance can still include unresolved proofs until the mint resolves them.

### Recovering an interrupted melt

A `reserved` row means the mint may still hold the inputs. Do not pay the invoice again until you know what happened; `melt` with the same `quoteId` fails with `PaymentFailed` while the quote is not `UNPAID`. In order:

1. Keep the `MeltQuote`. `PaymentFailed` also carries `quoteId` and `mint`.
2. Find the row: `Tokens.list` filtered to `state === "reserved"`.
3. Ask the mint with `status(quote)`:
   - `PAID` — the payment went through. `Validation.checkRow(rowId)` marks the inputs `error` once the mint reports them spent; change the response never delivered is recovered by [`Restore`](./restore.md) at that mint.
   - `UNPAID` — the mint reversed it. `checkRow` reports `live`; call `Tokens.returnToWallet(rowId)` to flip the row back to `accepted`, then decide whether to pay again with a new quote.
   - `PENDING` or no answer — leave the row `reserved` and check again later.

`checkAll` and `deleteSpent` skip `reserved` rows, so nothing else resolves them for you.

## Inputs and outputs

`MeltDraft` (`melt/domain.ts`):

| Field     | Type                       | Notes                                                |
| --------- | -------------------------- | ---------------------------------------------------- |
| `mint`    | `MintUrl`                  | mint to pay from                                     |
| `invoice` | `Bolt11Invoice`            | must start with `ln`                                 |
| `quoteId` | `Schema.optional(QuoteId)` | reuse a quote from `quote`; must belong to `invoice` |

`MeltQuote` (from `quote`):

| Field        | Type                         | Notes                                   |
| ------------ | ---------------------------- | --------------------------------------- |
| `quoteId`    | `QuoteId`                    |                                         |
| `mint`       | `MintUrl`                    |                                         |
| `amount`     | `Amount`                     | invoice amount in sat                   |
| `feeReserve` | `NonNegativeAmount`          | Lightning fee reserve the mint asks for |
| `expiresAt`  | `Schema.NullOr(UnixSeconds)` | null when the mint sets none            |

`MeltReceipt`:

| Field          | Type                | Notes                                                          |
| -------------- | ------------------- | -------------------------------------------------------------- |
| `mint`         | `MintUrl`           |                                                                |
| `quoteId`      | `QuoteId`           |                                                                |
| `paidAmount`   | `Amount`            | the invoice amount                                             |
| `feeReserve`   | `NonNegativeAmount` | what was reserved                                              |
| `feePaid`      | `NonNegativeAmount` | actual Lightning fee, `inputs - paidAmount - change`; may be 0 |
| `changeAmount` | `NonNegativeAmount` | returned as a fresh `accepted` row                             |

## Errors

| Tag                  | Kind               | When                                                                                                                    | What to do                                                                                                                       |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `InsufficientFunds`  | definitive         | balance below `amount + feeReserve` (`required` carries the sum)                                                        | choose another mint or a lower amount; the app's LN-address ladder uses `required`/`available` to size the retry                 |
| `QuoteExpired`       | definitive         | quote past `expiresAt`                                                                                                  | request a new quote                                                                                                              |
| `PaymentFailed`      | definitive/pending | mint reported `UNPAID`, the quote was not `UNPAID` when melting started, or the payment stayed `PENDING`; read `detail` | inputs back in balance: you may pay again with a new quote. Inputs still `reserved`: follow the recovery steps above             |
| `MintRejected`       | definitive         | malformed quote, quote/invoice mismatch, or mint rejection                                                              | surface `detail`; balance intact                                                                                                 |
| `MintUnreachable`    | transient          | network/timeout/5xx                                                                                                     | no `reserved` row: you may retry. A `reserved` row exists: the melt call was sent; follow the recovery steps before paying again |
| `CounterLockTimeout` | transient          | counter lease held elsewhere                                                                                            | you may retry                                                                                                                    |

## Related

- [fee-probe.md](./fee-probe.md) — estimate the fee before there is an invoice
- [lightning-utilities.md](./lightning-utilities.md) — invoice preview, LNURL invoice fetch, amount ladder
- [validation.md](./validation.md) — `checkRow` on `reserved` rows
- [errors.md](./errors.md)
