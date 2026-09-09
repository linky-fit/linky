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

The receipt carries `paidAmount`, `feePaid`, and `changeAmount`. Passing `quoteId` reuses the priced quote; omitting it makes `melt` request a fresh one (the CLI's `melt <invoice>` does that, `apps/linkshu-cli/src/commands.ts`). A payment the mint has not settled by the time `melt` returns fails with `PaymentPending`; the package keeps a durable record of it, and `resumePending` finishes it later.

## How it works

`quote` costs nothing and touches no row. `melt` does the following, in order:

1. **Price.** Fetch (or re-check) the melt quote. It must be `UNPAID` and not past `expiresAt`.
2. **Select sources.** `accepted` rows at `mint`, NUT-07 filtered; fully spent rows are marked `error`. Needs `amount + feeReserve`, else `InsufficientFunds`.
3. **Swap fee-inclusive.** Exactly `amount + feeReserve` (plus its own cashu input fee) is swapped out under the counter lock.
4. **Persist before melting.** The remainder becomes an `accepted` row (`melt-keep`); the melt inputs become a `reserved` row; a melt record (quote, invoice, the reserved row id, amounts, and the blank-output slot once an attempt is sent) is written to the `KeyValueStore`; the consumed source rows are removed. Funds are never outside the store, and from here on the payment is reconstructible from storage alone.
5. **Melt and settle.**

| Mint answer                       | Result                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PAID`                            | change proofs become an `accepted` row (`melt-change`); the `reserved` row and the record are removed; receipt resolves            |
| `UNPAID`                          | the `reserved` row flips back to `accepted`, the record is removed; `PaymentFailed`                                                |
| `PENDING`                         | polled briefly; `PAID`/`UNPAID` as above, still pending → `PaymentPending`, the inputs **stay `reserved`** under the record        |
| response lost (`MintUnreachable`) | the quote is checked once; `PAID`/`UNPAID` as above, no answer → `PaymentPending`, the inputs **stay `reserved`** under the record |
| definitive rejection              | the `reserved` row flips back to `accepted`, the record is removed; `MintRejected`                                                 |

`status(quote)` re-reads a quote's state (`"UNPAID" | "PENDING" | "PAID" | null`) without side effects.

Only proofs explicitly reported `UNSPENT` are offered to the swap. `PENDING`, missing, and unrecognized states are excluded from its available amount. After a successful swap, unresolved proofs remain in their original rows; only the consumed part is removed. A failed swap leaves those rows intact. Stored balance can still include unresolved proofs until the mint resolves them.

### `resumePending` — run it at startup

A `PaymentPending` failure, or a crash after step 4, leaves a record and a `reserved` row. Nothing looks at them until you run `resumePending`, which asks the mint about every record and returns one `MeltResumeResult` per record:

| Mint answer      | `status`     | What happened                                                                                                                                              |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAID`           | `paid`       | change is reclaimed via NUT-09 over the recorded blank slots and persisted as `accepted` (`melt-change`); the row and record are removed; `receipt` is set |
| `UNPAID`         | `unpaid`     | the `reserved` row flips back to `accepted`; the record is removed                                                                                         |
| `PENDING`        | `pending`    | row and record untouched                                                                                                                                   |
| no usable answer | `unresolved` | row and record untouched; the mint could not be loaded, did not answer, or rejected the change reclaim                                                     |

Only the mint's own answer retires a record. Quote expiry is not an unlock deadline: a quote past `expiresAt` that the mint still reports `PENDING` stays reserved, because the payment may yet settle either way. Call `resumePending` once when your runtime comes up and again whenever connectivity returns; running it over a record twice is safe, and it never fails.

```ts
import { Effect } from "effect";
import { Melt } from "@linky/linkshu";

const settleInterruptedMelts = Effect.gen(function* () {
  const melt = yield* Melt;
  for (const result of yield* melt.resumePending) {
    if (result.status === "paid") {
      console.log("paid", result.quoteId, "fee", result.receipt?.feePaid);
    } else {
      console.log(result.status, result.quoteId);
    }
  }
});
```

The CLI runs it as `melt` with no invoice (`apps/linkshu-cli/src/commands.ts`); Linky runs it next to the topup and autoswap resumers in `useLinkshuComposition.ts` and updates the payment's history entry from the result.

Do not pay the invoice again while a record exists: `melt` with the same `quoteId` fails with `PaymentFailed` while the quote is not `UNPAID`. `Tokens.returnToWallet` on the `reserved` row releases it locally without asking the mint; leave that to `resumePending`.

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

`MeltResumeResult` (from `resumePending`):

| Field     | Type                                              | Notes                                      |
| --------- | ------------------------------------------------- | ------------------------------------------ |
| `quoteId` | `QuoteId`                                         |                                            |
| `mint`    | `MintUrl`                                         |                                            |
| `rowId`   | `TokenRowId`                                      | the `reserved` inputs row the record named |
| `amount`  | `Amount`                                          | the invoice amount                         |
| `status`  | `"paid" \| "unpaid" \| "pending" \| "unresolved"` | see the table above                        |
| `receipt` | `Schema.NullOr(MeltReceipt)`                      | set for `paid` only                        |

## Errors

| Tag                  | Kind       | When                                                                                                       | What to do                                                                                                        |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `InsufficientFunds`  | definitive | balance below `amount + feeReserve` (`required` carries the sum)                                           | choose another mint or a lower amount; the app's LN-address ladder uses `required`/`available` to size the retry  |
| `QuoteExpired`       | definitive | quote past `expiresAt`                                                                                     | request a new quote                                                                                               |
| `PaymentFailed`      | definitive | mint reported `UNPAID`, or the quote was not `UNPAID` when melting started; read `detail`                  | inputs are back in balance; you may pay again with a new quote                                                    |
| `PaymentPending`     | pending    | the melt was sent and the mint has not settled it (`PENDING` past the poll, or a lost response unresolved) | inputs stay `reserved` in `rowId` under a record; record the payment as pending and let `resumePending` settle it |
| `MintRejected`       | definitive | malformed quote, quote/invoice mismatch, or mint rejection                                                 | surface `detail`; balance intact                                                                                  |
| `MintUnreachable`    | transient  | network/timeout/5xx before the melt request was sent                                                       | balance intact, no record; you may retry                                                                          |
| `CounterLockTimeout` | transient  | counter lease held elsewhere                                                                               | you may retry                                                                                                     |

`resumePending` never fails; an unreachable mint shows up as `status: "unresolved"`.

## Related

- [fee-probe.md](./fee-probe.md) — estimate the fee before there is an invoice
- [lightning-utilities.md](./lightning-utilities.md) — invoice preview, LNURL invoice fetch, amount ladder
- [topup.md](./topup.md) — the same resume pattern for incoming Lightning
- [errors.md](./errors.md)
