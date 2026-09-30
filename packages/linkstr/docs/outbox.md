# Outbox

`Outbox` is the send queue: enqueue a job, get a deterministic rumor id back immediately, and let a background worker deliver it with retries until a relay accepts it. Use it for sends that must survive offline periods and restarts; send directly for everything else.

## Storage and lifetime

Two things decide whether the queue is actually durable:

- **The store.** The job list lives behind the `OutboxStore` port. The default, `OutboxStore.inMemory`, is lost on restart; pass `OutboxStore.fromStringStorage(storage, key)` (one JSON array under `key`, `storage` is any `{ getItem, setItem }`) through `linkstrServices({ outboxStore })`, `runLinkstr` or `LinkstrConfig.outboxStore`. An unreadable stored value decodes as an empty list. Receipts persisted by older package versions (without a `_tag`, some keyed by `messageId` / `reactionId` / `telemetryId` instead of `rumorId`) still decode, so upgrading never drops queued jobs.
- **The runtime.** The delivery worker is scoped to the `Outbox` service. When the runtime that built it closes, the worker stops; queued jobs stay in the store and resume when the next runtime builds the service. A `runLinkstr` call that enqueues and returns therefore delivers nothing by itself.

## Enqueue, deliver, observe

Keep one long-lived runtime, mount the results consumer once, and enqueue through the same runtime:

```ts
import { Effect, ManagedRuntime, Stream } from "effect";
import {
  linkstrServices,
  MessageText,
  NostrTransportSimplePool,
  Outbox,
  OutboxRef,
  OutboxStore,
  TextMessageDraft,
  type NostrSecretKey,
  type OutboxResult,
  type Pubkey,
  type RelayUrl,
  type StringStorage,
} from "@linky-fit/linkstr";

/** Placeholder: write the outcome to the row named by `result.ref`. */
declare const persistResult: (result: OutboxResult) => Promise<void>;

export const startOutbox = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  storage: StringStorage,
) => {
  const runtime = ManagedRuntime.make(
    linkstrServices({
      secretKey,
      readRelays: relays,
      writeRelays: relays,
      transport: NostrTransportSimplePool,
      outboxStore: OutboxStore.fromStringStorage(storage, "myapp.outbox"),
    }),
  );

  // Persist each completed result, then ack it. Mount exactly once per runtime.
  runtime.runFork(
    Effect.flatMap(Outbox, (outbox) =>
      Stream.runForEach(outbox.results, (result) =>
        Effect.promise(() => persistResult(result)).pipe(
          Effect.andThen(outbox.ack(result.jobId)),
        ),
      ),
    ),
  );

  const queueText = (to: Pubkey, text: string, rowId: string) =>
    runtime.runPromise(
      Effect.flatMap(Outbox, (outbox) =>
        outbox.enqueue(
          {
            _tag: "chat.text",
            draft: new TextMessageDraft({
              to,
              content: MessageText.make(text),
            }),
          },
          OutboxRef.make(`message:${rowId}`),
        ),
      ),
    );

  return { queueText, stop: () => runtime.dispose() };
};
```

In React the runtime is `linkstrRuntimeAtom`, the consumer is `useOutboxResults`, and enqueueing is `enqueueOutboxAtom` ([react.md](./react.md#outbox)).

`enqueue(operation, ref)` returns an `EnqueueReceipt` at once: `{ jobId, ref, rumorId, clientId, sentAt }`. The rumor is encoded at enqueue time, so `rumorId` is the exact id every retry publishes; write it to your local row now. Enqueue success means the job is stored, not that any relay accepted it.

| Operation `_tag`   | `draft`                               | Delivered by                               |
| ------------------ | ------------------------------------- | ------------------------------------------ |
| `chat.text`        | `TextMessageDraft`                    | `Chat.sendText`                            |
| `chat.token`       | `TokenMessageDraft`                   | `Chat.sendToken`                           |
| `chat.image`       | `ImageMessageDraft`                   | `Chat.sendImage`                           |
| `chat.edit`        | `EditMessageDraft`                    | `Chat.edit`                                |
| `reaction`         | `ReactionDraft`                       | `Reactions.react`                          |
| `paymentTelemetry` | `PaymentTelemetryDraft` + `recipient` | `PaymentTelemetry.publishPaymentTelemetry` |

`enqueueTelemetry(draft, recipient, ref)` is separate and returns only an `OutboxJobId`: telemetry is signed by a fresh key per attempt, so there is no rumor id to precompute.

`ref` is an opaque `OutboxRef` you choose (for example `message:<rowId>`). It comes back unchanged on the result and is the only link between a completed result and your row.

Everything else (retractions, seen receipts, payment notices, bank offers, plain events) is sent directly and fails at once with the error its guide names; a queued send never fails on a delivery error, it retries. Seen receipts in particular must stay direct: a retried stale cursor would move the peer's marker backwards.

## Retry and ordering

- Delivery runs in two lanes, each **strictly FIFO**: one job at a time, in enqueue order. Chat and reaction jobs share the foreground lane; `paymentTelemetry` jobs have a background lane of their own, so a report the collector's relays keep refusing never holds back a chat send. Within a lane a job that keeps failing blocks the ones behind it.
- Delivery errors (`RecipientNotReached`, `NoRelayReachable`, `WrapNotDelivered`) are retried automatically: sleep 1 s, doubling to a 60 s cap, forever. You never retry a queued job yourself.
- A new enqueue cuts the current sleep of its own lane short; a browser `online` event (when `globalThis` dispatches one) wakes both lanes.
- Only two things end a job without success: an unexpected defect (`OutboxJobFailed` with `reason: "unexpected-error"`) and a job enqueued under another pubkey found at startup (`reason: "identity-changed"`). Jobs are never sent under a different key than they were enqueued with.
- A completed job stays stored as `awaiting-ack` until you `ack(jobId)`. Rebuilding the service re-emits every unacked result (at-least-once), so result handlers must be idempotent.

## Results

`outbox.results` is a single-consumer `Stream<OutboxResult>` of completed jobs only:

| Result               | Fields                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `OutboxJobSucceeded` | `jobId`, `ref`, `receipt` (`ChatMessageReceipt` \| `MessageEditReceipt` \| `ReactionReceipt` \| `PaymentTelemetryReceipt`) |
| `OutboxJobFailed`    | `jobId`, `ref`, `reason` (`identity-changed` \| `unexpected-error`), `detail`                                              |

Persist the outcome, then ack. `OutboxJobSucceeded` means a relay accepted the recipient copy ([honest delivery](./concepts.md#honest-delivery)); the peer's own inbox still has to receive it. Match the row by `ref`, mark it sent with `receipt.rumorId` (or `receipt.editOf` for edits) and, if you track wraps, `receipt.selfCopy.wrapId`.

## Related

- [react.md](./react.md#outbox) — `enqueueOutboxAtom`, `useOutboxResults`
- [chat.md](./chat.md), [reactions.md](./reactions.md), [payment-kinds.md](./payment-kinds.md#payment-telemetry) — the verticals that go through the queue
