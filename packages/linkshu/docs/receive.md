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

The receipt's `tokenText` is the re-signed encoding of the proofs now in the wallet, never the input text. A failure rejects the promise with a `ReceiveError`; wrap the effect in `Effect.either` to get it as a value.

## How it works

1. Extract. `extractTokenText` finds a token inside arbitrary text: bare `cashuA…`/`cashuB…`, `cashu:`/`web+cashu:`/`lightning:`/`nostr:` schemes, URLs carrying the token in a query parameter, hash, or path, and legacy cashu.me JSON bundles.
2. Take the counter lock. Everything from here on runs under the lock of the mint's active keyset, so two contexts receiving one token see each other's outcome.
3. Dedup. The text is known when a `send` or a `done` receive carries it, or when any proof secret it encodes is already in the inventory, in any state. A match fails with `TokenAlreadyKnown` and touches nothing: swapping a token whose proofs the wallet holds would kill the stored copies. An unfinished receive of the text (`pending` or `failed`) is not a match; it is resumed in place (below).
4. Check the fee. The mint's input fee for the token's proofs (NUT-02) must leave something to sign, else `AmountConsumedByFee` before any inventory change.
5. Persist `pending`. A `receive` operation with the text is inserted before the swap.
6. Swap. Each attempt writes its first output slot and keyset onto the receive (`counter`, `keysetId`) and advances the counter past its whole output range before the request leaves, so whatever the mint signs in that range belongs to this receive alone. Counter collisions are retried by the package (up to five attempts); if recovery fails, the last rejection surfaces as `MintRejected`.
7. Persist the proofs `available`, then close the receive `done`. Only now does the receipt resolve.

Any failure after step 5 leaves the receive `failed` with the serialized error, transient or definitive. `Tokens.forget` closes it once it is not worth retrying. `Tokens.returnToWallet` on a `send` runs this same flow over the handed-out text.

## Resuming an unfinished receive

A reload, crash, or lost response can stop a receive anywhere between steps 5 and 7: the mint may already have spent the token and signed the outputs while the wallet stored nothing. Receiving the same text again, or `Tokens.returnToWallet(operationId)`, resumes the receive over the same operation. It first restores the outputs of the latest attempt from its recorded slot (NUT-09). If the mint signed them and reports the token spent, the proofs the inventory lacks and the mint reports unspent are stored, and the receive closes `done`. Otherwise the token is swapped again: nothing was signed, or the token is unspent and the slot holds outputs another device signed. A mint that refuses the restore is swapped again; one that cannot be reached, or leaves a proof state unanswered, leaves the receive `failed` with its slot intact for the next try.

The package runs no resumer for receives. On launch, receive the text of every `pending` receive in `Tokens.transfers` again.

## Errors

Guide-specific tags; the rest are in [errors.md](./errors.md).

| Tag                   | When                                                                             | Operation left behind       |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `TokenParseFailed`    | no token in the text, or it does not decode (`reason` says which)                | none                        |
| `TokenAlreadyKnown`   | a send or a finished receive carries this text, or its proofs are already stored | the existing one, untouched |
| `AmountConsumedByFee` | the token is worth no more than the mint's input fee for its proofs              | none                        |
| `TokenAlreadySpent`   | the mint reported the proofs spent; `Tokens.forget` closes the receive           | `failed`                    |

`MintRejected` and `MintUnreachable` leave the receive `failed`; `MintUnreachable` may be retried. `CounterLockTimeout` comes before anything is recorded; retry it.

## Related

- [tokens.md](./tokens.md): `returnToWallet`, `forget`, `reclaim`
- [send.md](./send.md): the reverse direction
- [concepts.md](./concepts.md#who-moves-what): why dedup is by text and by secret
