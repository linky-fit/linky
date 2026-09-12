# Receive

`Receive` turns pasted, scanned, or message-borne text into `available` proofs in the wallet. Use it whenever token text arrives from outside: a QR scan, a paste, a chat message, a URL, an npub.cash payout. One call parses, dedups, re-signs the proofs at the mint, and persists the result under a `receive` operation.

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

The receipt carries `amount`, `unit`, `mint`, and the `operationId` of the `receive` operation, now `done`. A failure rejects the promise with one of the tagged errors below; wrap the effect in `Effect.either` to get it as a value. In a long-lived app, run the same effect on your `ManagedRuntime` instead of `runLinkshu`.

## How it works

1. **Extract.** `extractTokenText` finds a token inside arbitrary text: bare `cashuA…`/`cashuB…`, `cashu:`/`web+cashu:`/`lightning:`/`nostr:` schemes, URLs carrying the token in a query parameter, hash, or path, and legacy cashu.me JSON bundles. Whitespace inside a token is compacted.
2. **Dedup.** The text is known when a `send` or `receive` transfer carries it (a `failed` receive does not count — its text is free to be tried again), or when any proof secret it encodes is already in the inventory, in any state. A match fails with `TokenAlreadyKnown` and touches nothing: swapping a token whose proofs the wallet holds would kill the stored copies.
3. **Persist `pending`.** A `receive` operation with the text is inserted before the mint is contacted.
4. **Swap.** Under the counter lock, the proofs are swapped for fresh deterministic outputs.
5. **Persist the proofs.** The fresh proofs are stored `available`, then the receive moves to `done`. Only now does the receipt resolve.

The package retries counter collisions at the mint automatically: on `outputs already signed` it walks the derivation tree with NUT-09 to the last signed slot (tolerating up to `DERIVATION_GAP_LIMIT` = 1000 unsigned positions, the room a few failed attempts' reserved blocks can leave) and retries just past it, so a counter that lags the tree by thousands of slots — another context or device used the seed — catches up in one retry. A receive on a fresh origin may therefore take a few extra restore requests. If recovery fails, the last rejection surfaces as `MintRejected`.

Any failure after step 3 leaves the receive `failed` with the serialized error in `error` — transient or definitive. Pasting the same text again retries it over the same operation (`Tokens.returnToWallet` on the transfer does the same); `Tokens.forget` closes it once it is not worth retrying. `Tokens.returnToWallet` on a `send` runs this same flow over the handed-out text.

## Inputs and outputs

`ReceiveDraft` (`receive/domain.ts`):

| Field  | Type                    | Notes                                                   |
| ------ | ----------------------- | ------------------------------------------------------- |
| `text` | `Schema.NonEmptyString` | raw scanned/pasted text; the token is extracted from it |

`ReceiveReceipt`:

| Field         | Type           | Notes                                                                        |
| ------------- | -------------- | ---------------------------------------------------------------------------- |
| `operationId` | `OperationId`  | the `receive` (or, via `returnToWallet`, the returned `send`)                |
| `tokenText`   | `TokenText`    | the re-signed encoding of the proofs now in the wallet; never the input text |
| `mint`        | `MintUrl`      | normalized (no trailing slash)                                               |
| `unit`        | `CurrencyUnit` | from the token, `sat` when the encoding states none                          |
| `amount`      | `Amount`       | sum of the swapped proofs                                                    |

## Errors

| Tag                  | When                                                                                                                                           | Operation left behind       | What to do                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `TokenParseFailed`   | no token in the text (`reason: "empty"` / `"no-token-found"`), or it does not decode or states no mint (`"undecodable"`, `detail` may explain) | none                        | tell the user                                                            |
| `TokenAlreadyKnown`  | a transfer carries this text (`operationId`), or its proofs are already stored (`operationId` is the holding operation, or null for balance)   | the existing one, untouched | show that transfer, or the balance                                       |
| `TokenAlreadySpent`  | the mint reported the proofs spent (code `11001`)                                                                                              | `failed`                    | nothing to recover; `Tokens.forget` closes it                            |
| `MintRejected`       | definitive mint rejection (`code` when known), malformed swap response, or collision recovery exhausted                                        | `failed`                    | surface `detail`                                                         |
| `MintUnreachable`    | network, timeout, 5xx while loading the mint or swapping                                                                                       | `failed`                    | you may retry later: paste again or `Tokens.returnToWallet(operationId)` |
| `CounterLockTimeout` | another tab/process held the counter lease                                                                                                     | `failed`                    | you may retry                                                            |

## Related

- [tokens.md](./tokens.md) — `returnToWallet` re-receives through the same flow; `forget`
- [send.md](./send.md) — the reverse direction
- [errors.md](./errors.md) — transient vs definitive classification
- [inspector.md](./inspector.md) — the `receive.receive` operation and `ProofsChanged`/`OperationChanged` rows
- [../README.md](../README.md) — why dedup is by text and by secret, and why funds never leave the store
