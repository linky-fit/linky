# Receive

`Receive` turns pasted, scanned, or message-borne text into `available` proofs. One call parses, dedups, re-signs the proofs at the mint, and persists the result under a `receive` operation.

## Example

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft, runLinkshu } from "@linky-fit/linkshu";
import type { Bip39Seed, ReceiveReceipt } from "@linky-fit/linkshu";

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

The receipt carries `amount`, `unit`, `mint`, the `operationId` of the `receive` (now `done`), and `tokenText`: the re-signed encoding of the proofs now in the wallet, never the input text. A failure rejects the promise with a `ReceiveError`; wrap the effect in `Effect.either` to get it as a value.

## How it works

1. Extract. `extractTokenText` finds a token inside arbitrary text: bare `cashuA…`/`cashuB…`, `cashu:`/`web+cashu:`/`lightning:`/`nostr:` schemes, URLs carrying the token in a query parameter, hash, or path, and legacy cashu.me JSON bundles.
2. Dedup. The text is known when a `send` or `receive` transfer carries it (a `failed` receive does not count; its text may be tried again), or when any proof secret it encodes is already in the inventory, in any state. A match fails with `TokenAlreadyKnown` and touches nothing: swapping a token whose proofs the wallet holds would kill the stored copies.
3. Check the fee. The mint's input fee for the token's proofs (NUT-02) must leave something to sign, else `AmountConsumedByFee` before any inventory change.
4. Persist `pending`. A `receive` operation with the text is inserted before the swap.
5. Swap under the counter lock. Counter collisions are retried by the package (up to five attempts); if recovery fails, the last rejection surfaces as `MintRejected`.
6. Persist the proofs `available`, then close the receive `done`. Only now does the receipt resolve.

Any failure after step 4 leaves the receive `failed` with the serialized error, transient or definitive. Pasting the same text again retries it over the same operation, as does `Tokens.returnToWallet(operationId)`; `Tokens.forget` closes it once it is not worth retrying. `Tokens.returnToWallet` on a `send` runs this same flow over the handed-out text.

## Errors

Guide-specific tags; the rest are in [errors.md](./errors.md).

| Tag                   | When                                                                   | Operation left behind       |
| --------------------- | ---------------------------------------------------------------------- | --------------------------- |
| `TokenParseFailed`    | no token in the text, or it does not decode (`reason` says which)      | none                        |
| `TokenAlreadyKnown`   | a transfer carries this text, or its proofs are already stored         | the existing one, untouched |
| `AmountConsumedByFee` | the token is worth no more than the mint's input fee for its proofs    | none                        |
| `TokenAlreadySpent`   | the mint reported the proofs spent; `Tokens.forget` closes the receive | `failed`                    |

`MintRejected`, `MintUnreachable`, and `CounterLockTimeout` leave the receive `failed`; the transient two may be retried.

## Related

- [tokens.md](./tokens.md): `returnToWallet`, `forget`, `reclaim`
- [send.md](./send.md): the reverse direction
- [concepts.md](./concepts.md#who-moves-what): why dedup is by text and by secret
