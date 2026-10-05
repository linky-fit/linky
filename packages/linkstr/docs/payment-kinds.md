# Payment kinds

Three gift-wrapped verticals around payments, each with its own Linky-invented kind and `["linky", <value>]` marker: **payment notices** (24133) wake a peer up after a cashu token was sent in chat, **payment telemetry** (24134) reports a payment outcome anonymously to a collector pubkey, and **bank offers** (24135) carry the state of a proxy bank-payment offer between an offerer and a counterparty. Shared vocabulary and the error table are in [concepts.md](./concepts.md).

## Payment notices

`PaymentNotices.send(draft)` tells a peer "I just paid you" so their device can wake up and ingest the token that travelled in chat. The notice is a kind 24133 rumor wrapped **once**, to the recipient, and the wrap is push-marked, so a push server delivers a notification even though the token message itself was not push-marked ([chat.md](./chat.md#sending)). Send it after the token message was sent or enqueued; the token may still be in flight when the notice lands. In React use `sendPaymentNoticeAtom`.

```ts
import { Effect } from "effect";
import {
  PaymentNoticeDraft,
  PaymentNotices,
  type Pubkey,
} from "@linky-fit/linkstr";

const notifyPaid = (peer: Pubkey, offerId?: string) =>
  Effect.flatMap(PaymentNotices, (notices) =>
    notices.send(
      new PaymentNoticeDraft({
        to: peer,
        ...(offerId === undefined
          ? {}
          : { context: "bank_payment_offer", offerId }),
      }),
    ),
  );
```

`context` and `offerId` link the notice to a bank offer; leave both out for a plain contact payment. The receipt has no `selfCopy`: a notice is a signal, not state your other devices need. Not an outbox operation; when the send fails only the wake-up is lost.

### Wire format

Kind 24133. Tags, in order: `p` to, `p` author, `client`, `["linky", "payment_notice"]`, then `["context", context]` and `["offer", offerId]` when set. Content: the literal string `payment_notice`. One gift wrap to the recipient, always push-marked. A notice carries no value and is never ingested as a wallet event.

### Receiving

`PaymentNoticeReceived` means `from` paid you. The token arrives on the same inbox as a `ChatMessageReceived` with a `TokenBody`, and that handler is where you ingest it. Treat the notice as a wake-up: make sure the inbox is open, and show a notification for a `live` notice unless a matching token message is already stored. A push-opened process can get the same fact from `fetchWrapEvent` ([inbox.md](./inbox.md#fetchwrapevent-for-notification-opens)).

Drop reason: `invalid-notice` (wrong `linky` tag, not p-tagged to you, or authored by you; there is no own echo).

### Errors

`WrapNotDelivered`: no relay accepted the single wrap.

## Payment telemetry

`PaymentTelemetry.publishPaymentTelemetry(draft, recipient)` reports the outcome of a payment attempt to a collector pubkey without saying who reported it. Each attempt mints a fresh ephemeral key that authors the rumor, the seal and the wrap; the wrap goes to the recipient only, without a self copy or push marker. Retries of the same draft keep its `id`, so the collector can dedupe.

```ts
import { Effect } from "effect";
import {
  ClientId,
  decodeNpub,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
  PaymentTelemetry,
  PaymentTelemetryDraft,
  UnixSeconds,
} from "@linky-fit/linkstr";

const recipient = decodeNpub(PAYMENT_ANALYTICS_RECIPIENT_NPUB);
if (recipient === null) throw new Error("bad collector npub");

const report = new PaymentTelemetryDraft({
  id: ClientId.make(crypto.randomUUID()),
  createdAtSec: UnixSeconds.make(Math.floor(Date.now() / 1000)),
  direction: "out",
  status: "ok",
  method: "lightning_invoice",
  phase: "complete",
  paymentType: null,
  mint: "https://mint.example",
  amountBucket: "lte_1000",
  feeBucket: "lte_5",
  errorCode: null,
  errorDetail: null,
  appHost: "app.example",
  devicePlatform: "android",
  appRuntime: "pwa",
  appVersion: "1.2.3",
});

const publishOnce = Effect.flatMap(PaymentTelemetry, (telemetry) =>
  telemetry.publishPaymentTelemetry(report, recipient),
);
```

For durable delivery use `Outbox.enqueueTelemetry(draft, recipient, ref)` (`enqueuePaymentTelemetryAtom` in React): it retries with backoff on the outbox's background lane, so a failing report never delays chat sends, and returns an `OutboxJobId` rather than an `EnqueueReceipt`, because each attempt mints a new author and so a new rumor id ([outbox.md](./outbox.md)).

`createdAtSec` is when the payment event happened, not when it was sent. `paymentType` says what kind of payment went out: `contact` for a payment to a contact on either rail, `lightning` for an invoice or Lightning address paid outside a contact, `proxy` for the sats of a proxy payment, `recurring` for a run of a recurring payment, `request` for a paid payment request; receives, restores and top-ups carry `null`. It may be left out of the draft. `classifyPaymentErrorCode(message)` maps a raw error string to a stable `errorCode`; `detectTelemetryEnvironment(facts)` is pure and turns browser facts into `{ devicePlatform, appRuntime }`; `PAYMENT_ANALYTICS_RECIPIENT_NPUB` is Linky's collector.

Linkstr guarantees the transport side of anonymity (ephemeral author, no self copy, no push marker, addressed to the collector only). The draft is the only channel left: keep `id` random, report buckets rather than amounts, keep identifiers and invoice or token text out of `errorDetail`, and add no field that narrows down who paid; the wire stays `v: 1`, so a field added later (such as `paymentType`) is nullable and readers tolerate its absence.

### Wire format

Kind 24134. Tags, in order: `p` collector, `client` (the draft `id`), `["linky", "payment_telemetry"]`. Content is JSON with these keys in this order; nullable fields are written as `null`, never omitted:

```json
{
  "v": 1,
  "id": "…",
  "createdAtSec": 1758200000,
  "direction": "…",
  "status": "…",
  "method": "…",
  "phase": "…",
  "paymentType": null,
  "mint": null,
  "amountBucket": "…",
  "feeBucket": "…",
  "errorCode": null,
  "errorDetail": null,
  "appHost": "…",
  "devicePlatform": "…",
  "appRuntime": "…",
  "appVersion": "…"
}
```

### Receiving

Nothing. `WrapInbox` has no decoder for kind 24134 and drops it as `WrapDropped("unsupported-kind")`; the collector reads reports with its own tooling.

### Errors

`WrapNotDelivered` on a direct send; `OutboxJobFailed` on the results stream when queued.

## Bank offers

`BankOffers.send(draft)` (`sendBankOfferAtom` in React) carries the proxy-payment flow: someone scanned a bank QR and offers contacts to pay it in exchange for sats. Every step is a **snapshot** of the whole offer, a kind 24135 rumor tagged `["linky", "bank_payment_offer"]`, gift-wrapped to the counterparty and to yourself. Linkstr encodes and decodes snapshots and binds each status to the authenticated author; the state machine, authorization against known offers and the response rules live in `@linky-fit/proxy-payment` (its `docs/offers.md`), which is the reducer to use with these facts.

```ts
const receipt =
  yield *
  offers.send(
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
```

The receipt's `content` is the encoded snapshot JSON; persist it as the offer's local state so the local view and the wire agree byte for byte. To advance an offer you received, build the next draft from the stored snapshot and change only `status` and `text`; every snapshot repeats every field. `encodeBankOfferContent` produces the same JSON without sending, for a local placeholder row.

### Roles and statuses

Two roles: the **offerer** (who needs the bank payment made) and the counterparty. `offerer` is a field on every snapshot, independent of who authored it, because an offer goes to several contacts at once and both sides send statuses. The decoder drops a status authored by the wrong role.

| `BankOfferStatus`   | Sent by      | Meaning                                               | Push-marked |
| ------------------- | ------------ | ----------------------------------------------------- | ----------- |
| `offered`           | offerer      | new offer to this contact                             | yes         |
| `accepted`          | counterparty | I will pay it                                         | yes         |
| `accepted_by_other` | offerer      | someone else took it (sent to the remaining contacts) | yes         |
| `bank_details_sent` | offerer      | the payment details went out                          | yes         |
| `bank_paid`         | counterparty | I paid the bank                                       | yes         |
| `declined`          | counterparty | not taking it                                         | yes         |
| `canceled`          | offerer      | offer withdrawn                                       | no          |
| `settled`           | offerer      | sats sent, done                                       | no          |

`shouldPushBankOfferStatus(status)` encodes the last column; `pushMark` on the draft overrides it.

### Sending

`offerId` stays the same for every snapshot of one offer. `initiatedAtSec` defaults to `sentAt` when `status` is `offered`, `bankPaidAtSec` defaults to `sentAt` when `status` is `bank_paid`, and `statusUpdatedAtSec` is always the send time.

Delivery is **recipient first**: the self copy is published only after a relay accepted the counterparty's copy, so your other devices never sync a status the peer did not get. Not an outbox operation; a snapshot that fails is resent by the user or your own timers.

### Wire format

Kind 24135. Tags, in order: `p` to, `p` author, `client`, `["offer", offerId]`, `["offerer", offerer]`, `["linky", "bank_payment_offer"]`, `["status", status]`. Content is the snapshot JSON; key order is part of the format and `null` fields are omitted:

```json
{
  "amountText": "250 CZK",
  "offerId": "…",
  "offererPublicKey": "<hex pubkey>",
  "status": "offered",
  "statusUpdatedAtSec": 1758200000,
  "text": "…",
  "type": "linky.bank_payment_offer",
  "version": 1,
  "initiatedAtSec": 1758200000,
  "bankPaidAtSec": 1758200300,
  "expiresAtSec": 1758200600,
  "extensionSec": 300,
  "amountSat": 10000,
  "spdPayload": "SPD*1.0*…"
}
```

Decoding requires the marker, the reader among the `p` tags, and `type`, `offerId`, `amountText` plus a known `status` in the content. `offererPublicKey` falls back to the `offerer` tag. Every other field is optional and dropped when malformed rather than failing the snapshot.

### Receiving

`BankOfferSnapshotReceived` is a counterparty's snapshot (`from` authored it); `OwnBankOfferSnapshotConfirmed` is your own snapshot echoed (`to` is the peer). `BankOfferInboxEvent` is their union.

The codec establishes who authored a snapshot and that the role matches the status; it cannot know whether the offer exists or whether the terms changed. Feed every snapshot, live or backfill, idempotently into a reducer that keeps the authorized thread per peer and offer id. `applyBankPaymentOfferSnapshot` from `@linky-fit/proxy-payment` does this, including buffering payer snapshots that arrive before the offerer's during backfill.

Drop reason: `invalid-bank-offer` (wrong `linky` tag, not p-tagged to you, unparsable content, unknown `status`, no valid offerer pubkey, offerer absent from the participants, a status authored by the wrong role, or an own copy without a peer `p` tag).

### Errors

`NoRelayReachable` when no relay accepted the counterparty's copy; the self copy was never attempted, so `selfCopy` has empty relay lists. `RecipientNotReached` is in the signature but not produced by recipient-first delivery. Keep the previous local status and retry.
