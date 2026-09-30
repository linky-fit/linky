# Seen receipts

`SeenReceipts` tells a peer how far you have read their messages. A receipt is a kind 24136 rumor tagged `["linky", "seen_receipt"]`, gift-wrapped (kind 1059) to the peer and to yourself. It carries a **window cursor**, not per-message state: "I have seen your messages in `(sinceSec, seenUpToSec]`". Send one whenever the read cursor of an open conversation advances.

## Quick example

```ts
import { Effect } from "effect";
import {
  SeenReceiptDraft,
  SeenReceipts,
  UnixSeconds,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky-fit/linkstr";

const reportSeen = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
  receiptsEnabledAtSec: number,
  newestSeenMessageSec: number,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.flatMap(SeenReceipts, (receipts) =>
      receipts.send(
        new SeenReceiptDraft({
          to: peer,
          sinceSec: UnixSeconds.make(receiptsEnabledAtSec),
          seenUpToSec: UnixSeconds.make(newestSeenMessageSec),
        }),
      ),
    ),
  );
```

In React use `sendSeenReceiptAtom` ([react.md](./react.md)). When a send fails, roll your local "sent up to" value back; the next trigger resends a superseding receipt.

## The cursor model

- `seenUpToSec` — the newest `sentAt` you have seen from this peer. It travels as the rumor content.
- `sinceSec` — your receipts-enabled baseline, sent as the `since` tag. Messages older than it stay unmarked on the peer's side, so turning the feature on never retroactively marks history as read.
- The codec rejects `sinceSec >= seenUpToSec` on both ends.
- Every receipt supersedes all earlier ones for that peer. Keep an "already reported up to" value per peer and only send when the cursor moves forward; seed that value from `OwnSeenReceiptConfirmed` so a second device or a fresh session does not resend what the peer already has.

## Sending

`SeenReceiptDraft`: `to: Pubkey`, `sinceSec: UnixSeconds`, `seenUpToSec: UnixSeconds`, `clientId?: ClientId`, `sentAt?: UnixSeconds`. `send` returns a `SeenReceiptSendReceipt` (`rumorId`, `clientId`, `sentAt`, `selfCopy`, `recipientCopy`).

Direct only, and silent by design: not an outbox operation, because a retried receipt would republish a cursor that a later receipt already superseded, and a lost send self-heals on the next trigger. No `["linky", "push"]` marker on either wrap, so a receipt never produces a notification.

## Wire format

Two gift wraps, self and peer, never push-marked ([wire conventions](./concepts.md#wire-conventions)).

Kind 24136. Tags, in order: `p` to, `p` author, `client`, `["linky", "seen_receipt"]`, `["since", sinceSec]`. Content: `seenUpToSec` as a decimal string. Both numbers must be positive integers of at most eleven digits with `since` below the content.

## Receiving

| Tag                       | Fields                                                                                              | Meaning                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `SeenReceiptReceived`     | `receiptId: RumorId`, `from: Pubkey`, `sinceSec: UnixSeconds`, `seenUpToSec: UnixSeconds`, `sentAt` | the peer has seen your messages in `(sinceSec, seenUpToSec]` |
| `OwnSeenReceiptConfirmed` | `receiptId`, `to: Pubkey`, `sinceSec`, `seenUpToSec`, `clientId: ClientId \| null`, `sentAt`        | your own receipt echoed; `to` is the peer it was sent to     |

Apply `SeenReceiptReceived` monotonically (ignore anything that does not move the peer's cursor forward) and treat `seenUpToSec` as untrusted input: clamp it to shortly after "now" so a far-future cursor cannot mark everything seen forever. Record `OwnSeenReceiptConfirmed.seenUpToSec` as "already reported up to" for `to`.

Drop reasons this codec adds ([the full table](./inbox.md#authentication-and-drop-reasons)): `invalid-seen-receipt` (missing `linky` tag, unparsable seconds, `since >= seenUpTo`, or own copy without a peer `p` tag) and `not-addressed-to-me` (a peer's receipt that does not tag you).

## Errors

`RecipientNotReached` or `NoRelayReachable`; see [the error table](./concepts.md#errors). In both cases roll the local "sent up to" value back.

## Related

- [chat.md](./chat.md) — the messages the cursor covers
- [inbox.md](./inbox.md) — delivery of the facts above
