# Receive

`Receive` turns pasted, scanned, or message-borne text into an `accepted` row in the wallet. Use it whenever token text arrives from outside: a QR scan, a paste, a chat message, a URL, an npub.cash payout. One call parses, dedups, re-signs the proofs at the mint, and persists the result.

## Quick example

Prerequisites: a seed and, for anything but a throwaway wallet, durable stores — see [getting-started.md](./getting-started.md). The text comes from your scanner or paste handler.

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft, runLinkshu } from "@linky/linkshu";
import type { Bip39Seed, ReceiveReceipt } from "@linky/linkshu";

const receiveText = (
  bip39Seed: Bip39Seed,
  text: string,
): Promise<ReceiveReceipt> =>
  runLinkshu(
    { bip39Seed },
    Effect.gen(function* () {
      const receive = yield* Receive;
      return yield* receive.receive(new ReceiveDraft({ text }));
    }),
  );
```

The receipt carries `amount`, `unit`, `mint`, and the `rowId` of the new `accepted` row. A failure rejects the promise with one of the tagged errors below; wrap the effect in `Effect.either` to get it as a value. In a long-lived app, run the same effect on your `ManagedRuntime` instead of `runLinkshu`.

## How it works

1. **Extract.** `extractTokenText` finds a token inside arbitrary text: bare `cashuA…`/`cashuB…`, `cashu:`/`web+cashu:`/`lightning:`/`nostr:` schemes, URLs carrying the token in a query parameter, hash, or path, and legacy cashu.me JSON bundles. Whitespace inside a token is compacted.
2. **Dedup.** The extracted text is compared with every live row's `originalTokenText` and `tokenText`, in any state. A match fails with `TokenAlreadyKnown` and touches nothing. A re-paste of a token that already failed definitively therefore also reports "already known".
3. **Persist `pending`.** A row is inserted with `originalTokenText = tokenText = extracted text` and state `pending` before the mint is contacted.
4. **Swap.** Under the counter lock, the proofs are swapped for fresh deterministic outputs.
5. **Persist `accepted`.** The row's `tokenText` is rewritten to the fresh encoding and the state moves to `accepted`. Only now does the receipt resolve.

The package retries counter collisions at the mint automatically, so a receive on a fresh origin may take a few round-trips. If recovery fails, the last rejection surfaces as `MintRejected`.

## Inputs and outputs

`ReceiveDraft` (`receive/domain.ts`):

| Field  | Type                    | Notes                                                   |
| ------ | ----------------------- | ------------------------------------------------------- |
| `text` | `Schema.NonEmptyString` | raw scanned/pasted text; the token is extracted from it |

`ReceiveReceipt`:

| Field       | Type           | Notes                                                              |
| ----------- | -------------- | ------------------------------------------------------------------ |
| `rowId`     | `TokenRowId`   | the `accepted` row                                                 |
| `tokenText` | `TokenText`    | the re-signed encoding now stored on the row; never the input text |
| `mint`      | `MintUrl`      | normalized (no trailing slash)                                     |
| `unit`      | `CurrencyUnit` | from the token, `sat` when the encoding states none                |
| `amount`    | `Amount`       | sum of the swapped proofs                                          |

## Errors

Transient failures (`MintUnreachable`, `CounterLockTimeout`) remove the `pending` row and leave nothing behind. Definitive failures leave an `error` row whose `error` column holds the serialized tagged error.

| Tag                  | When                                                                                                                                           | Row left behind                       | What to do                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`   | no token in the text (`reason: "empty"` / `"no-token-found"`), or it does not decode or states no mint (`"undecodable"`, `detail` may explain) | none                                  | tell the user                                                                                                    |
| `TokenAlreadyKnown`  | a row with this text exists, in any state                                                                                                      | the existing row (`rowId`), untouched | show that row                                                                                                    |
| `TokenAlreadySpent`  | the mint reported the proofs spent (code `11001`)                                                                                              | `error`                               | nothing to recover, unless the token was only partially spent: `Tokens.returnToWallet` re-receives the live part |
| `MintRejected`       | definitive mint rejection (`code` when known), malformed swap response, or collision recovery exhausted                                        | `error`                               | surface `detail`                                                                                                 |
| `MintUnreachable`    | network, timeout, 5xx while loading the mint or swapping                                                                                       | none                                  | you may retry later                                                                                              |
| `CounterLockTimeout` | another tab/process held the counter lease                                                                                                     | none                                  | you may retry                                                                                                    |

## Related

- [tokens.md](./tokens.md) — `returnToWallet` re-receives through the same flow; lifecycle states
- [send.md](./send.md) — the reverse direction
- [errors.md](./errors.md) — transient vs definitive classification
- [inspector.md](./inspector.md) — the `receive.receive` operation and `TokenLifecycleChanged` rows
- [../README.md](../README.md) — why dedup is by token text and why funds never leave the store
