# Payment telemetry

`PaymentTelemetry` reports the outcome of a payment attempt to Linky's analytics pubkey without saying who reported it. A report is a kind 24134 rumor tagged `["linky", "payment_telemetry"]`, gift-wrapped (kind 1059) to the recipient only and signed by a fresh ephemeral key per attempt. Each attempt uses a new signing key; retries of the same draft keep its report id. The app records events locally first and hands them to the outbox in batches.

## Quick example

Prerequisites: a `NostrSecretKey` and relay urls — see [getting-started.md](./getting-started.md). The recipient is the exported analytics npub.

Build a report once; both send paths below take it as input. The app derives every value in `apps/web-app/src/app/lib/paymentTelemetry.ts`; the literals here are examples:

```ts
import {
  ClientId,
  PaymentTelemetryDraft,
  UnixSeconds,
  decodeNpub,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
} from "@linky/linkstr";

const recipient = decodeNpub(PAYMENT_ANALYTICS_RECIPIENT_NPUB);
if (recipient === null) throw new Error("bad analytics npub");

const report = new PaymentTelemetryDraft({
  id: ClientId.make(crypto.randomUUID()),
  createdAtSec: UnixSeconds.make(Math.floor(Date.now() / 1000)),
  direction: "out",
  status: "ok",
  method: "lightning_invoice",
  phase: "complete",
  mint: "https://mint.example",
  amountBucket: "lte_1000",
  feeBucket: "lte_5",
  errorCode: null,
  errorDetail: null,
  appHost: "app.linky.fit",
  devicePlatform: "android",
  appRuntime: "pwa",
  appVersion: "26.9.3",
});
```

Headless — one attempt:

```ts
import { Effect } from "effect";
import {
  PaymentTelemetry,
  runLinkstr,
  type NostrSecretKey,
  type PaymentTelemetryDraft,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const publishReport = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  draft: PaymentTelemetryDraft,
  recipient: Pubkey,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const telemetry = yield* PaymentTelemetry;
      return yield* telemetry.publishPaymentTelemetry(draft, recipient);
    }),
  );
```

React — durable, through the outbox:

```ts
import {
  OutboxRef,
  type PaymentTelemetryDraft,
  type Pubkey,
} from "@linky/linkstr";
import { enqueuePaymentTelemetryAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";

export const useEnqueueReport = () => {
  const enqueuePaymentTelemetry = useAtomSet(enqueuePaymentTelemetryAtom, {
    mode: "promiseExit",
  });

  return async (
    draft: PaymentTelemetryDraft,
    recipient: Pubkey,
  ): Promise<boolean> => {
    const exit = await enqueuePaymentTelemetry({
      draft,
      recipient,
      ref: OutboxRef.make(`telemetry:${draft.id}`),
    });
    return Exit.isSuccess(exit); // enqueued, not yet delivered
  };
};
```

Enqueue success means the job is persisted; drop the event from your local queue only then. Relay acceptance arrives later as an `OutboxJobSucceeded` carrying the `PaymentTelemetryReceipt` ([outbox.md](./outbox.md)).

## Sending

`PaymentTelemetryDraft` fields that need explanation (the union literals for `direction`, `status`, `method`, `phase`, `devicePlatform`, and `appRuntime` are on the exported types):

| Field                          | Note                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `id: ClientId`                 | random; also the `client` tag and the id retries share |
| `createdAtSec`                 | when the payment event happened, not when it was sent  |
| `mint`                         | normalized mint url or `null`                          |
| `amountBucket`, `feeBucket`    | bucket labels, never the amount                        |
| `errorCode`                    | from `classifyPaymentErrorCode`                        |
| `errorDetail`                  | short, truncated message                               |
| `appHost`                      | host name only                                         |
| `devicePlatform`, `appRuntime` | from `detectTelemetryEnvironment`                      |

Direct vs outbox: `publishPaymentTelemetry(draft, recipient)` is one attempt and returns a `PaymentTelemetryReceipt` (`rumorId`, `clientId`, `sentAt`, `recipientCopy`). `Outbox.enqueueTelemetry(draft, recipient, ref)` retries with backoff and returns the `OutboxJobId` rather than an `EnqueueReceipt`: each attempt mints a new author and so a new rumor id, while `draft.id` stays the same.

### Helpers

- `classifyPaymentErrorCode(message)` maps a raw error string to a stable code (`offline`, `timeout`, `insufficient`, … or `null` for empty input). Put the code in `errorCode`, not the message.
- `detectTelemetryEnvironment(facts)` takes `TelemetryEnvironmentFacts` gathered by the host (`userAgent`, `maxTouchPoints`, standalone flags, `nativePlatform`) and returns `{ devicePlatform, appRuntime }`. It is pure.
- `PAYMENT_ANALYTICS_RECIPIENT_NPUB` (`defaults.ts`) is the recipient; decode it with `decodeNpub`.
- `PAYMENT_TELEMETRY_KIND` / `PAYMENT_TELEMETRY_VALUE` are exported for tests and inspectors.

### Anonymity you must preserve

Linkstr guarantees the transport side: ephemeral author, no self copy, no push marker, and the wrap is addressed to the analytics key only. The draft is the only channel left, so:

- `id` must be random. Never derive it from your pubkey, owner id, or a message id.
- Report buckets, not amounts or fees. Bucketing lives in the app (`app/lib/paymentTelemetry.ts`).
- `errorDetail` must not contain invoices, token text, npubs, or contact names. The app truncates to 500 characters after classification.
- Do not add fields. The wire is `v: 1`; a new field is a schema change and a review of what it leaks.
- Through the outbox the draft is persisted in the `OutboxStore` until acked. It is stored under your pubkey for the `identity-changed` check, but that pubkey never leaves the device.

## Receiving

Nothing. `WrapInbox` has no decoder for kind 24134 and drops it as `WrapDropped("unsupported-kind")`; the analytics recipient reads reports with its own tooling.

## Errors

| Tag                    | When                                     | What to do                                             |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `WrapNotDelivered`     | direct send: no relay accepted the wrap  | keep the event in your local queue and retry later     |
| `OutboxJobFailed`      | `identity-changed` or `unexpected-error` | drop the item; a delivery error never terminates a job |
| `LinkstrNotConfigured` | React only, logged out                   | keep buffering locally                                 |

## Related

- [outbox.md](./outbox.md) — `enqueueTelemetry` and the results stream
- [identity-and-keys.md](./identity-and-keys.md) — `decodeNpub`
- [payment-notices.md](./payment-notices.md) — the other single-copy vertical
