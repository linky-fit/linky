# Topup

`Topup` receives over Lightning: it creates a mint quote, hands you the invoice to display, waits for it to be paid, and mints the proofs into an `accepted` row. Use it for "receive via Lightning", LNURL-withdraw, and (via `adopt`) invoices a lightning-address server paid on the wallet's behalf.

## Quick example

Prerequisites: a seed ([getting-started.md](./getting-started.md)) and the dev mint, which auto-pays its own invoices: `docker compose -f docker-compose.dev.yml up -d --wait cashu-mint`. Against a real mint, pay the printed invoice from another wallet.

```ts
import { Effect } from "effect";
import { Amount, MintUrl, runLinkshu, Topup, TopupDraft } from "@linky/linkshu";
import type { Bip39Seed } from "@linky/linkshu";

const topupOnce = (bip39Seed: Bip39Seed) =>
  runLinkshu(
    { bip39Seed },
    Effect.scoped(
      Effect.gen(function* () {
        const topup = yield* Topup;
        const handle = yield* topup.start(
          new TopupDraft({
            mint: MintUrl.make("http://localhost:3338"),
            amount: Amount.make(1000),
          }),
        );
        console.log("pay this:", handle.quote.invoice);
        const receipt = yield* handle.result; // resolves once paid and minted
        return receipt.rowId;
      }),
    ),
  );
```

`start` needs a `Scope`: the poll and any websocket subscription run as fibers in that scope. Close the scope and both stop; the persisted quote stays claimable through `resumePending`.

## How it works

1. **Quote.** `start` requests a bolt11 mint quote and persists it **before** returning the handle. Any invoice you can show is one the package can finish or resume.
2. **Watch.** The quote is polled until the mint reports it paid. Transient failures are tolerated (the device may be offline); a long run of them ends the poll with `MintUnreachable`, and an unknown quote (`MintRejected`) ends it at once. When the mint advertises NUT-17 websockets for the quote's method and unit, a subscription runs alongside and usually reports the settlement first. Established socket closes are observed separately from subscription-request errors. A dropped socket is re-subscribed with backoff, which also recovers the settlement it missed: the mint replays the quote's current state on subscribe. The poll keeps its full speed regardless, because the subscription is a shortcut and never a dependency — a socket may be blocked outright by a proxy or CSP even where the mint advertises one. A push never mints on its own either; the claim re-checks the quote over HTTP under the counter lock. If that check still says `UNPAID`, the topup releases the lock and resumes watching after five seconds; a settlement notification can arrive before the mint's HTTP state catches up.
3. **Mint under the counter lock.** If the mint says the quote was already issued (a lost response), the proofs are reclaimed via NUT-09 instead of minted twice; proofs already stored resolve to the existing row.
4. **Persist.** The row is inserted as `accepted` (`topup`), then the record is removed. A crash in between costs one reclaim scan on resume, never funds.

Expiry is decided only by the mint: a quote the mint still reports `UNPAID` after `expiresAt` (or 24 h after creation when the mint sets none) fails with `QuoteExpired`. The record is dropped unless minting had already begun. Poll errors reach `result` and cancel any active subscription; a silent or retrying subscription cannot delay them.

### `resumePending` — run it at startup

Records outlive the process. Nothing polls them until you call `resumePending()`, which returns a handle for every record, even those past their deadline. Call it once when your runtime comes up and again whenever connectivity returns; duplicate handles for the same quote are safe.

```ts
import { Effect, Either } from "effect";
import { Topup } from "@linky/linkshu";

const resumeTopups = Effect.scoped(
  Effect.gen(function* () {
    const topup = yield* Topup;
    for (const handle of yield* topup.resumePending()) {
      const outcome = yield* Effect.either(handle.result);
      if (Either.isRight(outcome)) {
        console.log(
          "minted",
          outcome.right.amount,
          "sat",
          handle.quote.quoteId,
        );
      } else if (outcome.left._tag === "QuoteExpired") {
        console.log("expired", handle.quote.quoteId);
      } else {
        // MintUnreachable, MintRejected, CounterLockTimeout: the record stays;
        // the next resume picks it up.
        console.log("not finished", handle.quote.quoteId, outcome.left._tag);
      }
    }
  }),
);
```

This waits for every handle inside one scope, which suits a CLI (`apps/linkshu-cli/src/commands.ts`, `topup` with no amount). In a long-lived app, extend the handles into a scope that outlives the call (`Scope.extend`) so polling survives UI unmounts, and close that scope before disposing the runtime; Linky does this in `useLinkshuComposition.ts`. Pass `{ lockingKey }` when the wallet adopts locked quotes (below).

### `adopt` — a quote someone else paid

A lightning-address server can create a mint quote for the wallet and pay its invoice. `adopt` mints such a quote from the server's paid-quote record, without polling: the mint is asked once.

```ts
import { Effect, Schema } from "effect";
import { PaidQuoteDraft, QuoteLockingKey, Topup } from "@linky/linkshu";

const decodePaidQuote = Schema.decodeUnknown(PaidQuoteDraft);

/** `paid` is the server's record; `lockingKeyHex` unlocks a NUT-20 locked quote. */
const adoptPaidQuote = (
  paid: {
    quoteId: string;
    mint: string;
    amount: number;
    invoice: string;
    expiresAt: number | null;
    locked: boolean;
  },
  lockingKeyHex: string | null,
) =>
  Effect.gen(function* () {
    const draft = yield* decodePaidQuote(paid);
    const topup = yield* Topup;
    return yield* topup.adopt(
      draft,
      lockingKeyHex === null
        ? {}
        : { lockingKey: QuoteLockingKey.make(lockingKeyHex) },
    );
  });
```

`locked` quotes (NUT-20) can only be minted with the secp256k1 secret they were locked to; the server tells you which key it used (Linky's npub.cash flow locks to the user's nostr key, so the nsec's hex form is the `lockingKey`). The key is passed to the mint call only, never persisted. `UNPAID` → `MintRejected`; already issued without a local record → `QuoteAlreadyIssued` (another wallet minted it).

## Inputs and outputs

`TopupDraft` (`topup/domain.ts`): `mint: MintUrl`, `amount: Amount`.

`TopupHandle`: `quote: TopupQuote`, `result: Effect<TopupReceipt, TopupError>`.

`TopupQuote`:

| Field       | Type                         |
| ----------- | ---------------------------- |
| `quoteId`   | `QuoteId`                    |
| `mint`      | `MintUrl`                    |
| `amount`    | `Amount`                     |
| `invoice`   | `Bolt11Invoice`              |
| `expiresAt` | `Schema.NullOr(UnixSeconds)` |

`PaidQuoteDraft` (for `adopt`): `quoteId`, `mint`, `amount`, `invoice`, `expiresAt`, `locked: boolean`. `TopupLockingOptions`: `{ lockingKey?: QuoteLockingKey }`.

`TopupReceipt`:

| Field       | Type         | Notes              |
| ----------- | ------------ | ------------------ |
| `rowId`     | `TokenRowId` | the `accepted` row |
| `tokenText` | `TokenText`  | minted encoding    |
| `mint`      | `MintUrl`    |                    |
| `amount`    | `Amount`     |                    |
| `quoteId`   | `QuoteId`    |                    |

## Errors

| Tag                  | Raised by                  | When                                                                          | What to do                                                                                      |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MintUnreachable`    | `start`, `result`, `adopt` | mint down at quote time, or repeated poll failures                            | for `result`: keep showing the invoice, the record persists; re-run `resumePending` when online |
| `MintRejected`       | `start`, `result`, `adopt` | unknown quote, unpaid adopted quote, locked quote without key, mint rejection | surface `detail`; a locked record stays pending for a resume that brings the key                |
| `QuoteExpired`       | `result`                   | mint confirms `UNPAID` past the deadline                                      | offer a new topup                                                                               |
| `QuoteAlreadyIssued` | `adopt`                    | mint already issued the quote and no local record claims it                   | nothing to mint here                                                                            |
| `CounterLockTimeout` | `result`, `adopt`          | counter lease held elsewhere                                                  | the record persists; resume later                                                               |

## Related

- [autoswap.md](./autoswap.md) — same claim machinery, invoice paid by your own melt
- [restore.md](./restore.md) — recovers proofs when a record was lost entirely
- [lightning-utilities.md](./lightning-utilities.md) — LNURL-withdraw against a topup invoice
- [inspector.md](./inspector.md) — `QuoteStateChanged` rows show the poll
