# Topup

`Topup` receives over Lightning: it creates a mint quote, hands you the invoice to display, waits for it to be paid, and mints the proofs into the balance. `adopt` mints a quote some other party created and paid on the wallet's behalf.

## Example

```ts
import { Effect } from "effect";
import {
  Amount,
  MintUrl,
  runLinkshu,
  Topup,
  TopupDraft,
} from "@linky-fit/linkshu";
import type { Bip39Seed } from "@linky-fit/linkshu";

const topupOnce = (bip39Seed: Bip39Seed, mint: MintUrl) =>
  runLinkshu(
    { bip39Seed },
    Effect.scoped(
      Effect.gen(function* () {
        const topup = yield* Topup;
        const handle = yield* topup.start(
          new TopupDraft({ mint, amount: Amount.make(1000) }),
        );
        console.log("pay this:", handle.quote.invoice);
        const receipt = yield* handle.result; // resolves once paid and minted
        return receipt.operationId;
      }),
    ),
  );
```

`start` needs a `Scope`: the poll and any websocket subscription run as fibers in it. Close the scope and both stop; the persisted `topup` operation stays claimable through `resumePending`. `TopupHandle` is `{ quote: TopupQuote, result: Effect<TopupReceipt, TopupError> }`; the receipt's `tokenText` encodes the minted proofs, which are stored `available`.

## How it works

1. Quote. `start` requests a bolt11 mint quote and persists it as a `pending` `topup` operation before returning the handle. Any invoice you can show is one the package can finish or resume.
2. Watch. The quote is polled every 5 s until the mint reports it paid. Transient failures keep the poll alive (the device may be offline); a long run of them ends it with `MintUnreachable`, and an unknown quote (`MintRejected`) ends it at once. When the mint advertises NUT-17 websockets, a subscription runs alongside as a shortcut (re-subscribed with backoff when dropped) but the poll never depends on it, and a push never mints on its own: the claim re-checks the quote over HTTP under the counter lock.
3. Mint under the counter lock. The reserved counter slot is written to the operation's `counter` (synced) and the counter advanced before the outputs are derived, so a resumed attempt re-derives the same outputs. If the mint says the quote was already issued (a lost response), the proofs are reclaimed via NUT-09 from that slot instead of minted twice.
4. Persist. The proofs are stored `available`, then the operation closes `done`.

Expiry is decided only by the mint: a quote it still reports `UNPAID` after `expiresAt` (or 24 h after creation when it sets none) fails with `QuoteExpired` and the operation closes `failed`, unless minting had already reserved a slot.

### `resumePending`

Pending topups outlive the process. `resumePending()` returns a handle for every `pending` topup, even those past their deadline; the shared rules are in [concepts.md](./concepts.md#resuming-interrupted-operations).

```ts
import { Effect, Either } from "effect";
import { Topup } from "@linky-fit/linkshu";

const resumeTopups = Effect.scoped(
  Effect.gen(function* () {
    const topup = yield* Topup;
    for (const handle of yield* topup.resumePending()) {
      const outcome = yield* Effect.either(handle.result);
      if (Either.isRight(outcome)) {
        console.log("minted", outcome.right.amount, handle.quote.quoteId);
      } else if (outcome.left._tag === "QuoteExpired") {
        console.log("expired", handle.quote.quoteId);
      } else {
        // MintUnreachable, MintRejected, CounterLockTimeout: still pending,
        // the next resume picks it up.
      }
    }
  }),
);
```

This waits for every handle inside one scope, which suits a script. In a long-lived app, `Scope.extend` the handles into a scope that outlives the call so polling survives UI changes, and close that scope before disposing the runtime. Pass `{ lockingKey }` when the wallet adopts locked quotes (below).

### `adopt`: a quote someone else paid

A lightning-address server can create a mint quote for the wallet and pay its invoice. `adopt(draft: PaidQuoteDraft, options?)` mints such a quote without polling: the mint is asked once.

`locked` quotes (NUT-20) can only be minted with the secp256k1 secret they were locked to (`QuoteLockingKey`, 64 hex chars); the key is passed to the mint call only, never persisted. A pending topup already recorded for the quote is minted through the same claim. Otherwise the mint's `UNPAID` answer is a `MintRejected`, and already issued without a local record is `QuoteAlreadyIssued` (another wallet minted it).

## Errors

| Tag                  | Raised by                  | When                                                                          | Operation                                                        |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `QuoteExpired`       | `result`                   | mint confirms `UNPAID` past the deadline                                      | `failed`; offer a new topup                                      |
| `QuoteAlreadyIssued` | `adopt`                    | mint already issued the quote and no local operation claims it                | none; nothing to mint here                                       |
| `MintRejected`       | `start`, `result`, `adopt` | unknown quote, unpaid adopted quote, locked quote without key, mint rejection | a locked pending topup stays `pending` for a resume with the key |

`MintUnreachable` (from `result`: keep showing the invoice, the operation stays `pending`) and `CounterLockTimeout` (stays `pending`; resume later) are in [errors.md](./errors.md).

## Related

- [autoswap.md](./autoswap.md): same claim machinery, invoice paid by your own melt
- [lightning-utilities.md](./lightning-utilities.md): LNURL-withdraw against a topup invoice
- [inspector.md](./inspector.md): `QuoteStateChanged` rows show the poll
