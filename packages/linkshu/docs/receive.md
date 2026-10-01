# Receive

`Receive` turns pasted, scanned, or message-borne text into `available` proofs. One call parses, dedups, re-signs the proofs at the mint, and persists the result under a `receive` operation. A token whose mint cannot be used is kept as a deferred receive that `resumeDeferred` finishes later.

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

The receipt's `tokenText` is the re-signed encoding of the proofs now in the wallet, never the input text. A failure rejects the promise with a `ReceiveError`; wrap the effect in `Effect.result` to get it as a value.

Set `automatic: true` on the draft when nobody asked for this receive, such as a token in a message replayed on a device. An automatic receive treats a text whose deferred receive is closed (received, discarded with `Tokens.forget`, or failed) as `TokenAlreadyKnown` and writes nothing, so a token given up on one device stays given up on every device that has synced it. It still resumes an unfinished receive of the text. A receive the user starts takes the text in again ([deferred receives](#deferred-receives)).

## Locked tokens (NUT-11)

A token whose proofs are locked to a key (P2PK) needs that key's secret to be received. Pass it as `receive(draft, { unlockingKey })` (`P2pkUnlockingKey`, 64 hex): the inputs are signed with it at the swap, and the proofs stored are plain wallet proofs. Without a key, or with one the proofs are not locked to, the receive fails with `TokenLocked` (its `pubkeys` name who can sign) before anything is written or asked. Proofs whose lock has expired without a refund key need no key. The key reaches the swap only; nothing persists or logs it.

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft } from "@linky-fit/linkshu";
import type { P2pkUnlockingKey } from "@linky-fit/linkshu";

const receiveLocked = (text: string, unlockingKey: P2pkUnlockingKey) =>
  Effect.flatMap(Receive, (receive) =>
    receive.receive(new ReceiveDraft({ text, automatic: true }), {
      unlockingKey,
    }),
  );
```

`resumeDeferred` has no key, so a locked token deferred while its mint was down stays `pending`; receive its text again with the key to finish it.

## How it works

1. Extract. `extractTokenText` finds a token inside arbitrary text: bare `cashuA…`/`cashuB…`, `cashu:`/`web+cashu:`/`lightning:`/`nostr:` schemes, URLs carrying the token in a query parameter, hash, or path, and JSON proof bundles (`{mint, unit, proofs}`: legacy cashu.me exports and the NUT-18 payment payload other wallets send). Then a P2PK lock the given key cannot sign for ends the receive with `TokenLocked`.
2. Take the mint's receive lease, held to the end of the receive. It is per mint, whatever keyset a context's wallet binds, so two contexts receiving one token see each other's outcome even across a keyset rotation, and a mint's deferrals are read and written in turn. Then load the mint and decode the token's proofs. The mint's keysets expand the short keyset ids of v4 text and decide dedup and the fee; when the ids do not resolve, the keysets are refreshed from the mint once. A mint that cannot be reached, refuses to load (an HTTP 4xx such as a 429 rate limit, or a captive-portal page instead of JSON), has not loaded or refreshed within 15 seconds, or binds the wallet to a keyset id that is not hex, ends the receive before anything else is written: a fresh token is deferred (below), and a receive retried through `Tokens.returnToWallet` or by receiving its text again fails with `MintUnreachable` or `MintRejected`. A token whose proofs still do not decode after a refresh names no keyset of the mint and fails `TokenParseFailed` (`undecodable`), writing nothing; a deferral of it closes `failed`.
3. Take the counter lock of the mint's active keyset. Everything from here on runs under it as well.
4. Dedup. The text is known when a `send` or a `done` receive carries it, when any proof secret it encodes is already in the inventory, in any state, or, to an `automatic` receive, when its deferral is closed. A match fails with `TokenAlreadyKnown` and touches nothing: swapping a token whose proofs the wallet holds would kill the stored copies. An unfinished receive of the text (`pending` or `failed`) is not a match; it is resumed in place (below).
5. Check the fee. The mint's input fee for the token's proofs (NUT-02) must leave something to sign, else `AmountConsumedByFee` before any inventory change.
6. Check the proof states (NUT-07), when the mint lists NUT-07 in its info; taking back a `send` skips it, its handed-out proofs being the wallet's own. A proof the mint reports `SPENT` fails with `TokenAlreadySpent` and nothing is written, unless the receive's own recorded attempt spent it (below). A mint that cannot be reached, rejects the check, reports a proof `PENDING` or leaves one unanswered, or has not answered within 15 seconds defers a fresh token and fails a retried receive (as in step 2) with `MintUnreachable` or `MintRejected`, writing nothing else.
7. Dedup again over freshly loaded operations and proofs: a receive of the text may have synced in from another device while the mint answered.
8. Persist `pending`. A `receive` operation with the text is inserted, or the unfinished one reopened, before the swap. A `pending` deferral of the text closes `done` with it.
9. Swap. Each attempt writes its first output slot and keyset onto the receive (`counter`, `keysetId`) and advances the counter past its whole output range before the request leaves, so whatever the mint signs in that range belongs to this receive alone. Counter collisions are retried by the package (up to five attempts); if recovery fails, the last rejection surfaces as `MintRejected`.
10. Persist the proofs `available`, then close the receive `done`. Only now does the receipt resolve.

Any failure of the swap leaves the receive `failed` with the serialized error, transient or definitive. Failures before step 8 write nothing but a deferral. `Tokens.forget` closes a failed receive once it is not worth retrying. `Tokens.returnToWallet` on a `send` runs this same flow over the handed-out text.

## Resuming an unfinished receive

A reload, crash, or lost response can stop a receive anywhere between steps 8 and 10: the mint may already have spent the token and signed the outputs while the wallet stored nothing. Receiving the same text again, or `Tokens.returnToWallet(operationId)`, resumes the receive over the same operation.

When the state check reports the token spent, the outputs of the latest attempt are restored from its recorded slot (NUT-09). If the mint signed them, the proofs the inventory lacks and the mint reports unspent are stored, and the receive closes `done`. If the slot holds nothing, or the receive recorded no attempt, the token was spent elsewhere: `TokenAlreadySpent`, and the receive stays as it was. When the check reports the token unspent, it is swapped again past the burned slots. A mint that refuses the restore counts as holding nothing; one that cannot be reached, or leaves a proof state unanswered, leaves the receive as it was, slot intact, for the next try. On a mint that does not list NUT-07 nothing proves the slot's outputs are the receive's own, so a resume swaps again; a token its earlier attempt spent then fails the swap with `TokenAlreadySpent`, and the outputs the mint signed come back only through [`Restore`](./restore.md).

The package runs no resumer for `receive` operations. On launch, receive the text of every `pending` receive in `Tokens.transfers` again.

## Two devices receiving the same token

A receive's operation id derives from its token text, so two devices of one identity receiving the same token share one operation row, and a device that has not yet synced the other's `done` receive would write over it. That is why nothing is written before the mint has answered for every input: a restored device whose history has not synced yet gets `TokenAlreadySpent` for every token it already received, and writes nothing. The second dedup catches a receive that synced in while the mint answered, and a resumed receive writes `done` only from outputs its own recorded slot proves; it never writes `pending` or `failed` over a token another device spent.

What remains (#470):

- When both devices pass the state check before either has synced, the swap that loses at the mint writes `failed` over the winner's `done`, and that `failed` can sync to every device. The funds are not lost, since the winner's proofs are stored, but history shows a failed receive for a token that arrived.
- A mint that does not list NUT-07 is received without the check, so on such a mint a device that has not synced can write over another device's `done` the same way.
- A `pending` receive another device finished at a slot this row never recorded stays `pending` until that device's `done` syncs in.
- A device that has not yet synced another device's discard (`Tokens.forget`) of a deferral, and receives its text automatically while the mint is down, keeps it `pending` again, and that write can sync over the discard.

## Deferred receives

A fresh token whose mint cannot be loaded or refreshed (step 2), or cannot be asked (step 6), fails with `ReceiveDeferred` and keeps its text under a `pending` `deferredReceive` operation, so a token with no other copy (a claim a server handed out once, a cleared paste field) is not lost. Its id derives from `deferredReceive|tokenText`, so it never shares a row with the token's `receive`, and a device whose mint is down writes nothing another device's `done` receive could be overwritten by. A pending deferral of the same text is reused. A text a transfer already carries fails with `TokenAlreadyKnown` instead, and an unfinished receive of the text fails with the mint's error, left for its own resume.

Receiving a deferred text again is a full receive: while the mint still cannot be used it returns the same `operationId`, and once the mint answers the `receive` it writes closes the deferral `done`. An unfinished receive of the text that finishes from its restored outputs closes the deferral too.

`resumeDeferred` receives the text of every `pending` deferral again, under the same steps, and returns one `DeferredReceiveResult` per deferral; the doc comment on its `status` says what each outcome means. The deferral ends as follows:

| `status`   | Deferral                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `received` | `done`                                                                                                                        |
| `closed`   | `done` when a transfer already carries the text, `failed` with the error otherwise; untouched if another pass closed it first |
| `failed`   | `done`; the token's `receive` is `failed` with the error                                                                      |
| `pending`  | kept                                                                                                                          |

A `closed` result created no `receive` and received no proofs. A `failed` result hands the token over to its `receive`: retry it with `Tokens.returnToWallet` or by receiving the text again, as any failed receive ([resuming](#resuming-an-unfinished-receive)).

A pass only ever moves a deferral it found `pending`, and moves it once: the deferral's status is read again under the mint's receive lease before its receive is written, and a deferral another pass or device closed meanwhile, or the user discarded with `Tokens.forget`, ends `closed` with nothing written. A pass never inserts or reopens a deferral; only a fresh receive of the text does. Two passes at once in two tabs record the token once; two devices race as described in [Two devices receiving the same token](#two-devices-receiving-the-same-token).

```ts
import { Effect } from "effect";
import { Receive } from "@linky-fit/linkshu";

const retryDeferred = Effect.gen(function* () {
  const receive = yield* Receive;
  for (const result of yield* receive.resumeDeferred) {
    if (result.status === "received" && result.receipt !== null) {
      // Announce result.receipt.amount like a live receive.
    }
  }
});
```

It never fails. Run it when the runtime comes up, when connectivity returns, and on a backoff while deferrals stay `pending`. Once one deferral at a mint stays `pending`, the rest at that mint wait for the next pass instead of each waiting out the timeout.

`Tokens.forget(operationId)` discards a `pending` deferral (`done`) when the user gives up on its mint ([tokens.md](./tokens.md#send-transitions)). It takes the mint's receive lease, so a discard issued while a receive at that mint runs waits for it to end. If that receive handed the deferral to its `receive`, the discard fails with `InvalidTransferTransition`, because the token is already being received; otherwise it closes the deferral, and no later pass brings it back. Nothing else holds the token, so keep its `tokenText` first; receiving that text again defers it once more while the mint is still down, or receives it once the mint answers. An `automatic` receive of the text fails with `TokenAlreadyKnown` instead, on this device and on every device that has synced the discard. `Mints.removeKnownMint` refuses a mint with a `pending` deferral ([mints.md](./mints.md#the-known-mint-set)).

## Errors

Guide-specific tags; the rest are in [errors.md](./errors.md).

| Tag                   | When                                                                                                                   | Operation left behind                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`    | no token in the text, or it does not decode, also against the mint's keysets (`reason` says which)                     | none                                                                                                        |
| `TokenLocked`         | the proofs are P2PK-locked and the receive was given no key, or one they are not locked to                             | none                                                                                                        |
| `TokenAlreadyKnown`   | a send or a finished receive carries this text, its proofs are already stored, or (`automatic`) its deferral is closed | the existing one, untouched                                                                                 |
| `AmountConsumedByFee` | the token is worth no more than the mint's input fee for its proofs                                                    | none                                                                                                        |
| `TokenAlreadySpent`   | the mint reported the proofs spent                                                                                     | none from the state check (a resumed receive as it was); `failed` from the swap (`Tokens.forget` closes it) |
| `ReceiveDeferred`     | before the swap, a fresh token's mint could not be loaded, refreshed or asked                                          | a `pending` `deferredReceive` (`operationId`); no `receive`                                                 |

A fresh receive returns `MintRejected` and `MintUnreachable` only from the swap, which leaves the receive `failed`; before the swap it defers instead. A receive retried through `Tokens.returnToWallet` or by receiving its text again returns them from loading the mint, refreshing its keysets or the state check too, and then writes nothing. `MintUnreachable` may be retried. `CounterLockTimeout` comes before anything is recorded, a deferral included (`keysetId` null when another context held the mint's receive lease for 30 s): retry it, and when your copy of the text is the only one (a token a server hands out once), keep it until a call ends any other way.

## Related

- [tokens.md](./tokens.md): `returnToWallet`, `forget`, `reclaim`
- [send.md](./send.md): the reverse direction
- [concepts.md](./concepts.md#who-moves-what): why dedup is by text and by secret
