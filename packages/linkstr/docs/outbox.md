# Outbox

`Outbox` is the send queue: enqueue a job, get a deterministic rumor id back immediately, and let a background worker deliver it with retries until a relay accepts it. Use it for user-visible sends that must survive offline periods and reloads; send directly for everything else.

## Storage and lifetime first

Two things decide whether the queue is actually durable:

- **The store.** The job list lives behind the `OutboxStore` port. The default, `OutboxStore.inMemory`, is lost on reload; pass `OutboxStore.fromStringStorage(storage, key)` (one JSON array under `key`; the web app uses `localStorage` and `"linky.outbox"`) through `linkstrServices({ outboxStore })`, `runLinkstr`, or `LinkstrConfig.outboxStore`. An unreadable stored value decodes as an empty list; two older receipt generations still decode, so upgrading never drops queued jobs.
- **The runtime.** The delivery worker is scoped to the `Outbox` service. When the runtime that built it closes, the worker stops; queued jobs stay in the store and resume when the next runtime builds the service. A `runLinkstr` call that enqueues and returns therefore delivers nothing by itself.

## One runtime: enqueue, deliver, observe

Prerequisite: a key and relays ([getting-started.md](./getting-started.md#what-you-bring)). Keep one long-lived runtime, mount the results consumer once, and enqueue through the same runtime:

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
} from "@linky/linkstr";

/** App callback placeholder: write the outcome to the row named by `result.ref`. */
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
      outboxStore: OutboxStore.fromStringStorage(storage, "linky.outbox"),
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

`enqueue(operation, ref)` returns an `EnqueueReceipt` at once: `{ jobId, ref, rumorId, clientId, sentAt }`. The rumor is encoded at enqueue time, so `rumorId` is the exact id every retry publishes; write it to your local row now. Enqueue success means the job is stored, not that any relay accepted it and not that the peer processed it.

| Operation `_tag`   | `draft`                               | Delivered by                               |
| ------------------ | ------------------------------------- | ------------------------------------------ |
| `chat.text`        | `TextMessageDraft`                    | `Chat.sendText`                            |
| `chat.token`       | `TokenMessageDraft`                   | `Chat.sendToken`                           |
| `chat.image`       | `ImageMessageDraft`                   | `Chat.sendImage`                           |
| `chat.edit`        | `EditMessageDraft`                    | `Chat.edit`                                |
| `reaction`         | `ReactionDraft`                       | `Reactions.react`                          |
| `paymentTelemetry` | `PaymentTelemetryDraft` + `recipient` | `PaymentTelemetry.publishPaymentTelemetry` |

`enqueueTelemetry(draft, recipient, ref)` is separate and returns only an `OutboxJobId`: telemetry is signed by a fresh key per attempt, so there is no rumor id to precompute.

`ref` is an opaque `OutboxRef` you choose (the app uses `message:<rowId>` and `reaction:<rowId>`). It comes back unchanged on the result and is the only link between a completed result and your row.

## When to use it

| Send                             | Path                       | Why                                                                                                      |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chat text, image, token, edit    | `Outbox.enqueue`           | must not be lost while offline; the optimistic row waits for the result                                  |
| Reaction (add)                   | `Outbox.enqueue`           | same                                                                                                     |
| Payment telemetry                | `Outbox.enqueueTelemetry`  | fire-and-forget but must eventually land                                                                 |
| Reaction retraction              | `Reactions.retract` direct | UX tolerates a failed undo                                                                               |
| Seen receipts                    | `SeenReceipts.send` direct | every receipt supersedes the previous one; a retried stale cursor would move the peer's marker backwards |
| Payment notices, bank offers     | direct                     | single-copy or ordered sends the app manages itself                                                      |
| Profiles, relay lists, mute list | direct                     | plain events; the caller re-publishes on demand                                                          |

A direct send fails at once with the error its guide lists (for example [chat.md](./chat.md), [reactions.md](./reactions.md), [profiles.md](./profiles.md)); a queued send never fails on a delivery error, it retries.

## Retry and ordering rules

- Delivery is **strictly FIFO**: one job at a time, in enqueue order. A job that keeps failing blocks the ones behind it.
- Delivery errors (`RecipientNotReached`, `NoRelayReachable`, `WrapNotDelivered`) are retried automatically: sleep 1s, doubling to a 60s cap, forever. You never retry a queued job yourself.
- A new enqueue and the browser `online` event both cut the current sleep short.
- Only two things end a job without success: an unexpected defect (`OutboxJobFailed` with `reason: "unexpected-error"`) and a job enqueued under another pubkey found at startup (`reason: "identity-changed"`). Jobs are never sent under a different key than they were enqueued with.
- A completed job stays stored as `awaiting-ack` until you `ack(jobId)`. Rebuilding the service re-emits every unacked result (at-least-once), so result handlers must be idempotent.

## Results

`outbox.results` is a single-consumer `Stream<OutboxResult>` of completed jobs only, success or permanent failure:

| Result               | Fields                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `OutboxJobSucceeded` | `jobId`, `ref`, `receipt` (`ChatMessageReceipt` \| `MessageEditReceipt` \| `ReactionReceipt` \| `PaymentTelemetryReceipt`) |
| `OutboxJobFailed`    | `jobId`, `ref`, `reason`, `detail`                                                                                         |

Persist the outcome, then ack, as in the example above. `OutboxJobSucceeded` means a relay accepted the recipient copy ([concepts.md](./concepts.md#honest-delivery)); the peer's own inbox still has to receive it. The web app's handler, `applyOutboxResult` in `apps/web-app/src/app/hooks/messages/outboxResults.ts`, parses the `ref` prefix and marks the row `sent` with `receipt.rumorId` (or `receipt.editOf` for edits) and `receipt.selfCopy.wrapId`; a failure is only logged.

## Related

- [react.md](./react.md#outbox) — `enqueueOutboxAtom`, `useOutboxResults`
- [chat.md](./chat.md), [reactions.md](./reactions.md), [payment-telemetry.md](./payment-telemetry.md) — the verticals that go through the queue
- [seen-receipts.md](./seen-receipts.md) — why receipts bypass it
- [concepts.md](./concepts.md#honest-delivery)
