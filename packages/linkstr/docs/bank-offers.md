# Bank offers

`BankOffers` carries the proxy-payment flow: you scanned a bank QR, and you offer contacts to pay it for you in exchange for sats. Every step is a **snapshot** of the offer — a kind 24135 rumor tagged `["linky", "bank_payment_offer"]`, gift-wrapped (kind 1059) to the counterparty and to yourself. Linkstr delivers snapshots and decodes them; which transitions are legal, who may send which status, and timers are app state (`useBankPaymentOffers`).

## Quick example

Prerequisites: a `NostrSecretKey`, relay urls, your own `Pubkey`, and the counterparty's `Pubkey` — see [getting-started.md](./getting-started.md).

Headless — open a new offer:

```ts
import { Effect } from "effect";
import {
  BankOfferDraft,
  BankOfferId,
  BankOffers,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const offer = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  me: Pubkey,
  peer: Pubkey,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const offers = yield* BankOffers;
      return yield* offers.send(
        new BankOfferDraft({
          to: peer,
          offerId: BankOfferId.make(crypto.randomUUID()),
          offerer: me,
          status: "offered",
          amountText: "250 CZK",
          text: "Can you pay this for me?",
          amountSat: 4200,
        }),
      );
    }),
  );
```

The promise resolves with a `BankOfferReceipt` once a relay accepted the peer's copy; persist `receipt.content` as the offer's local state.

React — advance an offer you received. Every snapshot carries the full state, so build the next draft from the stored one and change only `status` and `text`:

```ts
import {
  BankOfferDraft,
  type BankOfferSnapshotReceived,
  type BankOfferStatus,
} from "@linky/linkstr";
import { sendBankOfferAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";

const nextSnapshot = (
  offer: BankOfferSnapshotReceived,
  status: BankOfferStatus,
  text: string,
) =>
  new BankOfferDraft({
    to: offer.from,
    offerId: offer.offerId,
    offerer: offer.offerer,
    status,
    amountText: offer.amountText,
    text,
    ...(offer.amountSat === null ? {} : { amountSat: offer.amountSat }),
    ...(offer.initiatedAtSec === null
      ? {}
      : { initiatedAtSec: offer.initiatedAtSec }),
    ...(offer.bankPaidAtSec === null
      ? {}
      : { bankPaidAtSec: offer.bankPaidAtSec }),
    ...(offer.expiresAtSec === null
      ? {}
      : { expiresAtSec: offer.expiresAtSec }),
    ...(offer.extensionSec === null
      ? {}
      : { extensionSec: offer.extensionSec }),
    ...(offer.spdPayload === null ? {} : { spdPayload: offer.spdPayload }),
  });

interface OfferStore {
  /** Placeholder: store the accepted snapshot as the offer's local state. */
  saveSnapshot: (offerId: string, content: string, rumorId: string) => void;
}

export const useAcceptOffer = (store: OfferStore) => {
  const sendBankOffer = useAtomSet(sendBankOfferAtom, { mode: "promiseExit" });

  return async (offer: BankOfferSnapshotReceived): Promise<boolean> => {
    const exit = await sendBankOffer(
      nextSnapshot(offer, "accepted", "I will pay it"),
    );
    if (Exit.isFailure(exit)) return false; // keep the previous local status
    store.saveSnapshot(offer.offerId, exit.value.content, exit.value.rumorId);
    return true;
  };
};
```

## The flow, as linkstr sees it

Two roles: the **offerer** (who needs the bank payment made) and the counterparty. `offerer` is a field on every snapshot, independent of who authored it, because an offer goes to several contacts at once and both sides send statuses.

| `BankOfferStatus`   | Typically sent by | Meaning                                               | Push-marked |
| ------------------- | ----------------- | ----------------------------------------------------- | ----------- |
| `offered`           | offerer           | new offer to this contact                             | yes         |
| `accepted`          | counterparty      | I will pay it                                         | yes         |
| `accepted_by_other` | offerer           | someone else took it (sent to the remaining contacts) | yes         |
| `bank_details_sent` | offerer           | the payment details went out                          | yes         |
| `bank_paid`         | counterparty      | I paid the bank                                       | yes         |
| `declined`          | counterparty      | not taking it                                         | yes         |
| `canceled`          | offerer           | offer withdrawn                                       | no          |
| `settled`           | offerer           | sats sent, done                                       | no          |

`shouldPushBankOfferStatus(status)` encodes the last column; `pushMark` on the draft overrides it.

Delivery order is `recipientFirst`: the self copy is published only after a relay accepted the counterparty's copy, so your other devices never sync a status the peer did not get.

## Sending

`BankOfferDraft` fields are typed on the class; the ones with behaviour behind them:

- `offerId` is a `BankOfferId` (branded non-empty string), the same for every snapshot of one offer. `offerer` is the role, not the author.
- `amountText` is the display amount (`"250 CZK"`); `text` is display copy, which the app templates per status. `spdPayload` is the bank QR payload.
- `initiatedAtSec` defaults to `sentAt` when `status` is `offered`; `bankPaidAtSec` defaults to `sentAt` when `status` is `bank_paid`.
- `pushMark` overrides `shouldPushBankOfferStatus`; `clientId` is generated when omitted.

Repeat every field on every snapshot: the wire carries the full state, not a diff. `statusUpdatedAtSec` is always the send time.

`BankOfferReceipt` carries `rumorId`, `offerId`, `status`, `content: string`, `clientId`, `sentAt`, `selfCopy`, and `recipientCopy`. `content` is the encoded JSON snapshot; the app stores it as the message content of the offer row so the local view and the wire agree byte for byte. To produce that JSON without sending — for a local-only placeholder row — call `encodeBankOfferContent` with every field (`null` for absent ones); its parameter type is not exported, and `bankOfferContentFromSnapshot` in `apps/web-app/src/app/hooks/messages/inboxNotifications.ts` is a complete call.

Direct only: offers are not outbox operations. A snapshot that fails is simply resent by the user or the app's timers.

## Receiving

Both facts carry the draft fields above as nullable values (`text`, `amountSat`, the timestamps, `extensionSec`, `spdPayload`, `clientId`), plus `snapshotId: RumorId`, `statusUpdatedAtSec`, and `sentAt`. They differ only in who authored the wrap:

| Tag                             | Extra field    | Meaning                                    |
| ------------------------------- | -------------- | ------------------------------------------ |
| `BankOfferSnapshotReceived`     | `from: Pubkey` | a counterparty's snapshot                  |
| `OwnBankOfferSnapshotConfirmed` | `to: Pubkey`   | your own snapshot echoed; `to` is the peer |

```ts
import type {
  BankOfferInboxEvent,
  Pubkey,
  WrapInboxEvent,
} from "@linky/linkstr";

/** Placeholder: merge by (peer, offerId); the newest statusUpdatedAtSec wins. */
type ApplySnapshot = (peer: Pubkey, snapshot: BankOfferInboxEvent) => void;

export const bankOfferHandler =
  (applySnapshot: ApplySnapshot) =>
  (event: WrapInboxEvent): void => {
    if (event._tag === "BankOfferSnapshotReceived")
      applySnapshot(event.from, event);
    if (event._tag === "OwnBankOfferSnapshotConfirmed")
      applySnapshot(event.to, event);
  };
```

`event.offerer === myPubkey` tells you whether the offer is outgoing. Backfill replays old snapshots, so the merge must be idempotent.

Drop reason: `invalid-bank-offer` — wrong `linky` tag, not p-tagged to you, unparsable content, unknown `status`, or no valid offerer pubkey.

## Errors

| Tag                    | When                                                                                                              | What to do                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `NoRelayReachable`     | no relay accepted the counterparty's copy; the self copy was never attempted (`selfCopy` has empty relay lists)   | keep the previous local status; retry |
| `RecipientNotReached`  | in the error type but not produced here: recipient-first delivery never publishes the self copy before the peer's | handle like `NoRelayReachable`        |
| `LinkstrNotConfigured` | React only, logged out                                                                                            | do not send                           |

## Related

- [payment-notices.md](./payment-notices.md) — the notice sent with the sats (`context: "bank_payment_offer"`)
- [chat.md](./chat.md) — the token message that settles the offer
- [inbox.md](./inbox.md) — delivery phases
