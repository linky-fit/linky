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
2. Load the mint and decode the token's proofs. The mint's keysets expand the short keyset ids of v4 text and decide the fee; when the ids do not resolve, the keysets are refreshed from the mint once. A mint that does not load or refresh ends the receive before anything is written. A token whose proofs still do not decode after a refresh names no keyset of the mint and fails `TokenParseFailed` (`undecodable`), writing nothing.
3. Take the counter lock. Everything from here on runs under the lock of the mint's active keyset, so two contexts receiving one token see each other's outcome.
4. Dedup. The text is known when a `send` or a `done` receive carries it, or when any proof secret it encodes is already in the inventory, in any state. A match fails with `TokenAlreadyKnown` and touches nothing: swapping a token whose proofs the wallet holds would kill the stored copies. An unfinished receive of the text (`pending` or `failed`) is not a match; it is resumed in place (below).
5. Check the fee. The mint's input fee for the token's proofs (NUT-02) must leave something to sign, else `AmountConsumedByFee` before any inventory change.
6. Check the proof states (NUT-07), when the mint lists NUT-07 in its info; taking back a `send` skips it, its handed-out proofs being the wallet's own. A proof the mint reports `SPENT` fails with `TokenAlreadySpent` and nothing is written, unless the receive's own recorded attempt spent it (below). A mint that cannot be reached, rejects the check, reports a proof `PENDING` or leaves one unanswered, or has not answered within 15 seconds fails with `MintUnreachable` or `MintRejected`, and nothing is written either.
7. Dedup again over freshly loaded operations and proofs: a receive of the text may have synced in from another device while the mint answered.
8. Persist `pending`. A `receive` operation with the text is inserted, or the unfinished one reopened, before the swap.
9. Swap. Each attempt writes its first output slot and keyset onto the receive (`counter`, `keysetId`) and advances the counter past its whole output range before the request leaves, so whatever the mint signs in that range belongs to this receive alone. Counter collisions are retried by the package (up to five attempts); if recovery fails, the last rejection surfaces as `MintRejected`.
10. Persist the proofs `available`, then close the receive `done`. Only now does the receipt resolve.

Any failure of the swap leaves the receive `failed` with the serialized error, transient or definitive. Failures before step 8 write nothing. `Tokens.forget` closes a failed receive once it is not worth retrying. `Tokens.returnToWallet` on a `send` runs this same flow over the handed-out text.

## Resuming an unfinished receive

A reload, crash, or lost response can stop a receive anywhere between steps 8 and 10: the mint may already have spent the token and signed the outputs while the wallet stored nothing. Receiving the same text again, or `Tokens.returnToWallet(operationId)`, resumes the receive over the same operation.

When the state check reports the token spent, the outputs of the latest attempt are restored from its recorded slot (NUT-09). If the mint signed them, the proofs the inventory lacks and the mint reports unspent are stored, and the receive closes `done`. If the slot holds nothing, or the receive recorded no attempt, the token was spent elsewhere: `TokenAlreadySpent`, and the receive stays as it was. When the check reports the token unspent, it is swapped again past the burned slots. A mint that refuses the restore counts as holding nothing; one that cannot be reached, or leaves a proof state unanswered, leaves the receive as it was, slot intact, for the next try. On a mint that does not list NUT-07 nothing proves the slot's outputs are the receive's own, so a resume swaps again; a token its earlier attempt spent then fails the swap with `TokenAlreadySpent`, and the outputs the mint signed come back only through [`Restore`](./restore.md).

The package runs no resumer for receives. On launch, receive the text of every `pending` receive in `Tokens.transfers` again.

## Two devices receiving the same token

A receive's operation id derives from its token text, so two devices of one identity receiving the same token share one operation row, and a device that has not yet synced the other's `done` receive would write over it. That is why nothing is written before the mint has answered for every input: a restored device whose history has not synced yet gets `TokenAlreadySpent` for every token it already received, and writes nothing. The second dedup catches a receive that synced in while the mint answered, and a resumed receive writes `done` only from outputs its own recorded slot proves; it never writes `pending` or `failed` over a token another device spent.

What remains (#470):

- When both devices pass the state check before either has synced, the swap that loses at the mint writes `failed` over the winner's `done`, and that `failed` can sync to every device. The funds are not lost, since the winner's proofs are stored, but history shows a failed receive for a token that arrived.
- A mint that does not list NUT-07 is received without the check, so on such a mint a device that has not synced can write over another device's `done` the same way.
- A `pending` receive another device finished at a slot this row never recorded stays `pending` until that device's `done` syncs in.

## Errors

Guide-specific tags; the rest are in [errors.md](./errors.md).

| Tag                   | When                                                                                               | Operation left behind                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`    | no token in the text, or it does not decode, also against the mint's keysets (`reason` says which) | none                                                                                                        |
| `TokenAlreadyKnown`   | a send or a finished receive carries this text, or its proofs are already stored                   | the existing one, untouched                                                                                 |
| `AmountConsumedByFee` | the token is worth no more than the mint's input fee for its proofs                                | none                                                                                                        |
| `TokenAlreadySpent`   | the mint reported the proofs spent                                                                 | none from the state check (a resumed receive as it was); `failed` from the swap (`Tokens.forget` closes it) |

`MintRejected` and `MintUnreachable` from loading the mint, refreshing its keysets or the state check write nothing; from the swap they leave the receive `failed`. `MintUnreachable` may be retried. `CounterLockTimeout` comes before anything is recorded; retry it.

## Related

- [tokens.md](./tokens.md): `returnToWallet`, `forget`, `reclaim`
- [send.md](./send.md): the reverse direction
- [concepts.md](./concepts.md#who-moves-what): why dedup is by text and by secret
