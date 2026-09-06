# Payment notices

`PaymentNotices` tells a peer "I just paid you" so their device can wake up and ingest the cashu token that travelled in chat. A notice is a kind 24133 rumor tagged `["linky", "payment_notice"]`, gift-wrapped (kind 1059) to the recipient, and the wrap is push-marked, so the push server delivers a notification even though the token message itself was not push-marked. Send one after the token message's outbox job was enqueued; the token may still be awaiting delivery when the notice lands.

## Quick example

Prerequisites: a `NostrSecretKey`, relay urls, and the peer's `Pubkey` — see [getting-started.md](./getting-started.md).

Headless:

```ts
import { Effect } from "effect";
import {
  PaymentNoticeDraft,
  PaymentNotices,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const notifyPaid = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const notices = yield* PaymentNotices;
      return yield* notices.send(new PaymentNoticeDraft({ to: peer }));
    }),
  );
```

The promise resolves with a `PaymentNoticeReceipt` once a relay accepted the wrap; `receipt.recipientCopy.wrapId` is what the push server will deliver.

React — called after the token message was enqueued:

```ts
import { PaymentNoticeDraft, type Pubkey } from "@linky/linkstr";
import { sendPaymentNoticeAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";

export const useNotifyPaid = () => {
  const sendPaymentNotice = useAtomSet(sendPaymentNoticeAtom, {
    mode: "promiseExit",
  });

  return async (peer: Pubkey, offerId?: string): Promise<boolean> => {
    const exit = await sendPaymentNotice(
      new PaymentNoticeDraft({
        to: peer,
        ...(offerId === undefined
          ? {}
          : { context: "bank_payment_offer", offerId }),
      }),
    );
    // On failure only the wake-up is lost; the token job stays in the outbox.
    return Exit.isSuccess(exit);
  };
};
```

The app calls this from `publishCashuMessagePayment` once at least one `chat.token` job was enqueued successfully, and does not retry a failed notice.

## Sending

| Draft                | Fields                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PaymentNoticeDraft` | `to: Pubkey`, `context?: "bank_payment_offer"`, `offerId?: string` (non-empty, trimmed), `clientId?: ClientId` |

- `context` and `offerId` link the notice to a bank offer; leave both out for a plain contact payment.
- No `sentAt`: the notice is always stamped now.

`PaymentNoticeReceipt` carries `rumorId`, `clientId`, `sentAt`, and `recipientCopy: WrapDelivery`.

Single copy, direct, push-marked. There is no `selfCopy` because nothing is wrapped to you: a notice is a signal, not state your other devices need. It is not an outbox operation; if the send fails the payment itself is unaffected.

## Receiving

| Tag                     | Fields                                                                                                                         | Meaning         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `PaymentNoticeReceived` | `noticeId: RumorId`, `from: Pubkey`, `context: "bank_payment_offer" \| null`, `offerId: string \| null`, `sentAt: UnixSeconds` | `from` paid you |

The notice carries no token. The token arrives on the same inbox as a `ChatMessageReceived` with a `TokenBody` ([chat.md](./chat.md#cashu-tokens)), and that handler is where you ingest it. Treat the notice as a wake-up: make sure the inbox is open so the token message can arrive, and show a notification unless a matching token message is already stored.

```ts
import type { InboxDelivery, Pubkey, WrapInboxEvent } from "@linky/linkstr";

interface PaymentUi {
  // Placeholders for your app.
  hasTokenFrom: (peer: Pubkey) => boolean;
  showPaidToast: (peer: Pubkey, offerId: string | null) => void;
}

export const paymentNoticeHandler =
  (ui: PaymentUi) =>
  (event: WrapInboxEvent, delivery: InboxDelivery): void => {
    if (event._tag !== "PaymentNoticeReceived") return;
    if (delivery !== "live" || ui.hasTokenFrom(event.from)) return;
    ui.showPaidToast(event.from, event.offerId);
  };
```

The service worker takes the same fact from `WrapInbox.fetchWrapEvent` to decide the notification title for a pushed wrap (see [push-inbox.md](./push-inbox.md)).

Drop reason: `invalid-notice` — wrong `linky` tag, not p-tagged to you, or authored by you.

## Errors

| Tag                    | When                              | What to do                                   |
| ---------------------- | --------------------------------- | -------------------------------------------- |
| `WrapNotDelivered`     | no relay accepted the single wrap | log it; the token job is still in the outbox |
| `LinkstrNotConfigured` | React only, logged out            | do not send                                  |

`WrapNotDelivered` carries `rumorId`, `clientId`, `sentAt`, `recipientCopy`.

## Related

- [chat.md](./chat.md) — the token messages a notice announces
- [bank-offers.md](./bank-offers.md) — `context: "bank_payment_offer"`
- [push-inbox.md](./push-inbox.md) — how the push marker is consumed
- [inbox.md](./inbox.md) — delivery phases (`live` vs `backfill`)
