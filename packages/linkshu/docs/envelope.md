# Envelopes

`Envelope` reserves an amount at one mint under a key you choose. Its outputs derive from the seed and the key alone, so every device and tab holding the seed builds the same blinded messages for a key, and the mint signs them only once. The first wallet to fund a key creates the envelope; every later one adopts it. Use it for a payment that must go out at most once while several devices may try it at the same time.

## Example

```ts
import { Effect } from "effect";
import {
  Envelope,
  EnvelopeKey,
  EnvelopeOpenDraft,
  EnvelopeRef,
} from "@linky-fit/linkshu";
import type { Amount, MintUrl } from "@linky-fit/linkshu";

const payOnce = (mint: MintUrl, amount: Amount) =>
  Effect.gen(function* () {
    const envelope = yield* Envelope;
    const key = EnvelopeKey.make("rent:2026-10");
    const ref = new EnvelopeRef({ mint, key });
    yield* envelope.open(new EnvelopeOpenDraft({ mint, key, amount }));
    const state = yield* envelope.state(ref);
    if (state.status !== "unspent") return state.status;
    const token = yield* envelope.send(ref);
    return token.tokenText; // deliver it; every device gets the same text
  });
```

The mint, not your own records, says whether the payment happened: run `open`, then `state`, then deliver, and retry the same steps after any failure or crash. `open` is idempotent and never funds a key twice.

## Keys

One key names one payment forever. Once a key has been funded, opening it again adopts that envelope, even after it was spent or released, so never reuse a key for a different payment. Keys are not secret (the seed is what makes the outputs spendable) and appear in inspector params; keep them free of personal data.

The derivation is domain-separated HMAC-SHA256 over the seed and the key, one secret and blinding factor per output slot, with no counter, keyset id or amount in it. An envelope holds one power-of-two denomination per slot, in ascending order, so slot 0 is always used and a restore over slots 0 to 63 finds the whole envelope.

## How it works

`open`, `send`, `release` and `Melt.meltEnvelope` take a lease on the key in the `KeyValueStore`, so one context of a device works on an envelope at a time. A context that waits 15 s for it fails with `EnvelopeBusy`.

Every call that finds the envelope stored here first stores the proof rows its operation names but this device lacks (a crash between writing the operation and its rows, or a sync that brought only the operation), in the state the operation implies: `held` while `pending`, `handedOut` once `issued`. A stored row `held` with no holder (its `operationId` never synced) goes back under the envelope; other stored rows keep their state and holder.

### `open`

1. Look locally. An envelope this device already stores is returned as `adopted`, without asking the mint.
2. Probe the mint (NUT-09 over the key's slots). Whatever it signed is stored `held` under a new `envelope` operation and returned as `adopted`, with the amount its creator chose; the requested `amount` is ignored.
3. Fund. `amount` has to exceed the input fee whoever spends the envelope pays (else `AmountConsumedByFee`). Confirmed-unspent `available` proofs at `mint` are swapped into the envelope's outputs, change on the deterministic counter; a confirmed total below `amount` fails with `InsufficientFunds` before any mint write. The `envelope` operation and its `held` proofs are stored first, then the change `available`, then the consumed inputs `spent`. The result is `created`.
4. If the swap fails, the mint is probed once more: another device that funded the key meanwhile makes this swap fail on the envelope's outputs or on synced inputs, and its envelope is adopted. Otherwise the swap's error is returned. After `MintUnreachable` the mint may have signed the swap whose answer was lost; the next `open` (or `state`) finds that envelope at step 2 and adopts it.

### `state`

`state(ref)` asks the mint about the envelope (NUT-09 when it is not stored here, then NUT-07) and returns an `EnvelopeState`:

| `status`  | Meaning                                                    | Caller should                                            |
| --------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `absent`  | nobody funded the key                                      | `open` it                                                |
| `unspent` | funded, every proof unspent                                | deliver it: `send` or `Melt.meltEnvelope`                |
| `pending` | an input of a melt the mint has not settled                | wait; `Melt.resumePending` settles a melt of this wallet |
| `spent`   | every proof spent: melted, or redeemed by the token holder | treat the payment as made                                |
| `mixed`   | some proofs spent, some not                                | stop and ask the user                                    |

An envelope another device funded is adopted on the way. Proofs the mint reports spent are marked `spent`, and an envelope whose proofs are all spent closes `done`.

#### After a restore

The counter scan of [restore.md](./restore.md) cannot see envelopes: their outputs do not derive from a counter. After a restore, or when a device starts, call `state` for every key the wallet may hold. Unspent envelopes are adopted and stay `held`; `release` those you no longer need. A `MintUnreachable` or `MintRejected` leaves the key unchecked; ask again later.

### `send`

`send(ref)` returns the envelope as an `EnvelopeToken`: its proofs become `handedOut` and the operation `issued`. The text is the same on every device, and sending again returns it again. A send that stopped halfway (proofs `handedOut`, operation still `pending`, after a crash or a sync that mixed two devices' writes) is finished by the next one, which returns the same text. The recipient pays the mint's input fee when redeeming it. An envelope that is not open here (never opened, already melted, spent or released, or held by a melt) fails with `EnvelopeNotFound`.

### Melting

`Melt.meltEnvelope` pays an invoice with the envelope's proofs ([melt.md](./melt.md#paying-from-an-envelope)). A melt that does not pay puts them back in the envelope, never into the balance, also on a device the envelope's operation has not synced to yet: the melt carries the envelope's text.

### `release`

`release(ref)` swaps an unspent envelope back into the balance and returns the fresh amount after the mint's fee (`EnvelopeReleased`). The envelope's proofs are marked `spent` and it closes `returned`; an envelope stored nowhere is adopted first. It returns 0 without asking the mint when the envelope was handed out as a token (operation `issued`, or any proof `handedOut`): that token is its recipient's money, and `send` and `release` share the lease, so a release never invalidates a token a `send` returned on this device. It also returns 0 when nothing is unspent or nobody funded the key; a proof the mint reports pending fails with `EnvelopeBusy`. This device cannot see a token another device sent whose writes have not synced yet, so release only envelopes that were never meant to be delivered as a token.

## Operation and proof states

| `envelope` status | Proofs                                     | Next                                                           |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `pending`         | `held` under the envelope, or under a melt | `issued` by `send`, `done` once spent, `returned` by `release` |
| `issued`          | `handedOut` under the envelope             | `done` once the mint reports them spent                        |
| `done`            | `spent`                                    | terminal                                                       |
| `returned`        | `spent`; fresh proofs are `available`      | terminal                                                       |

The operation's `tokenText` names its proofs, so its id is the same on every device that stores the envelope.

## Errors

| Tag                | From                                           | When                                                                                                       |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `EnvelopeBusy`     | `open`, `send`, `release`, `Melt.meltEnvelope` | another context of this device holds the key's lease; `release` also when the mint reports a proof pending |
| `EnvelopeNotFound` | `send`, `Melt.meltEnvelope`                    | the envelope is not open on this device                                                                    |

`InsufficientFunds`, `AmountConsumedByFee`, `MintUnreachable`, `MintRejected`, `CounterLockTimeout` and `TokenAlreadySpent` are in [errors.md](./errors.md). Every failure is safe to retry with the same key.

## Related

- [melt.md](./melt.md#paying-from-an-envelope): paying an invoice from an envelope
- [restore.md](./restore.md): what the counter scan finds and what it cannot
- [concepts.md](./concepts.md): proof states and the leases
