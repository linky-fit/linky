# Seen receipts

`SeenReceipts` tells a peer how far you have read their messages. A receipt is a kind 24136 rumor tagged `["linky", "seen_receipt"]`, gift-wrapped (kind 1059) to the peer and to yourself. It carries a **window cursor**, not per-message state: "I have seen your messages in `(sinceSec, seenUpToSec]`". Send one whenever the read cursor of an open conversation advances.

## Quick example

Headless:

```ts
import { Effect } from "effect";
import {
  SeenReceiptDraft,
  SeenReceipts,
  UnixSeconds,
  runLinkstr,
} from "@linky/linkstr";

await runLinkstr(
  { secretKey, readRelays, writeRelays },
  Effect.gen(function* () {
    const receipts = yield* SeenReceipts;
    return yield* receipts.send(
      new SeenReceiptDraft({
        to: peer,
        sinceSec: UnixSeconds.make(receiptsEnabledAtSec),
        seenUpToSec: UnixSeconds.make(newestSeenMessageSec),
      }),
    );
  }),
);
```

React:

```ts
import { SeenReceiptDraft, UnixSeconds } from "@linky/linkstr";
import { sendSeenReceiptAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";

const sendSeenReceipt = useAtomSet(sendSeenReceiptAtom, {
  mode: "promiseExit",
});

const exit = await sendSeenReceipt(
  new SeenReceiptDraft({
    to: peer,
    sinceSec: UnixSeconds.make(receiptsEnabledAtSec),
    seenUpToSec: UnixSeconds.make(newestSeenMessageSec),
  }),
);
if (Exit.isFailure(exit)) rollBackSentCursor(peer); // the next trigger resends a superseding receipt
```

## The cursor model

- `seenUpToSec` — the newest `sentAt` you have seen from this peer. It travels as the rumor content.
- `sinceSec` — your receipts-enabled baseline, sent as the `since` tag. Messages older than it stay unmarked on the peer's side, so turning the feature on never retroactively marks history as read.
- The decoder rejects `sinceSec >= seenUpToSec`.
- Every receipt supersedes all earlier ones for that peer. Keep an "already reported up to" value per peer and only send when the cursor moves forward; seed that value from `OwnSeenReceiptConfirmed` so a second device or a fresh session does not resend what the peer already has.

## Sending

| Draft              | Fields                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `SeenReceiptDraft` | `to: Pubkey`, `sinceSec: UnixSeconds`, `seenUpToSec: UnixSeconds`, `clientId?: ClientId`, `sentAt?: UnixSeconds` |

| Receipt                  | Fields                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `SeenReceiptSendReceipt` | `rumorId`, `clientId`, `sentAt`, `selfCopy: WrapDelivery`, `recipientCopy: WrapDelivery` |

Direct only, and silent by design:

- Not through the outbox. A retried receipt would republish a cursor that a later receipt already superseded. A lost send self-heals on the next trigger (new message, tab refocus, route re-entry) because that receipt carries the newer cursor anyway.
- No `["linky", "push"]` marker on either wrap, so a receipt never produces a notification.

## Receiving

| Tag                       | Fields                                                                                              | Meaning                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `SeenReceiptReceived`     | `receiptId: RumorId`, `from: Pubkey`, `sinceSec: UnixSeconds`, `seenUpToSec: UnixSeconds`, `sentAt` | the peer has seen your messages in `(sinceSec, seenUpToSec]` |
| `OwnSeenReceiptConfirmed` | `receiptId`, `to: Pubkey`, `sinceSec`, `seenUpToSec`, `clientId: ClientId \| null`, `sentAt`        | your own receipt echoed; `to` is the peer it was sent to     |

```ts
import type { WrapInboxEvent } from "@linky/linkstr";

const onEvent = (event: WrapInboxEvent): void => {
  switch (event._tag) {
    case "SeenReceiptReceived":
      // Monotonic: ignore anything that does not move the peer's cursor forward.
      return advancePeerSeen(event.from, {
        sinceSec: event.sinceSec,
        seenUpToSec: event.seenUpToSec,
      });
    case "OwnSeenReceiptConfirmed":
      return recordSentSeenReceipt(event.to, event.seenUpToSec);
    default:
      return;
  }
};
```

Treat `seenUpToSec` from a peer as untrusted input: the app clamps it to shortly after "now" so a far-future cursor cannot mark everything seen forever.

Drop reasons: `invalid-seen-receipt` (missing `linky` tag, unparsable seconds, `since >= seenUpTo`, or own copy without a peer p-tag) and `not-addressed-to-me`.

## Errors

| Tag                    | When                                  | What to do                                                       |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `RecipientNotReached`  | self copy landed, peer's copy did not | roll the local "sent up to" value back; the next trigger resends |
| `NoRelayReachable`     | nothing accepted                      | same                                                             |
| `LinkstrNotConfigured` | React only, logged out                | do not send                                                      |

## Related

- [chat.md](./chat.md) — the messages the cursor covers
- [inbox.md](./inbox.md) — delivery of the facts above
- [reactions.md](./reactions.md) — the own-echo split this codec mirrors
- `docs/architecture.md` — "Linkstr protocol package", seen-receipts paragraph, for the design rationale
