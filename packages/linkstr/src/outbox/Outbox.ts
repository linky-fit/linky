import { Cause, Duration, Effect, Exit, Option, Queue, Stream } from "effect";
import { Chat } from "../chat/Chat";
import {
  encodeEditRumor,
  encodeImageMessageRumor,
  encodeTextMessageRumor,
  encodeTokenMessageRumor,
} from "../chat/codec";
import {
  EditMessageDraft,
  ImageMessageDraft,
  TextMessageDraft,
  TokenMessageDraft,
} from "../chat/domain";
import type {
  NoRelayReachable,
  RecipientNotReached,
  WrapNotDelivered,
} from "../domain/errors";
import { EventId, RumorId } from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { OperationFailed, PlainOperationSucceeded } from "../inspector/events";
import type { Rumor } from "../internal/nostrEvent";
import { freshClientId } from "../internal/operations";
import { nowSeconds } from "../internal/time";
import type { PaymentTelemetryDraft } from "../paymentTelemetry/domain";
import { PaymentTelemetry } from "../paymentTelemetry/PaymentTelemetry";
import { encodeReactionRumor } from "../reactions/codec";
import { ReactionDraft } from "../reactions/domain";
import { Reactions } from "../reactions/Reactions";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import {
  EnqueueReceipt,
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  StoredOutboxJob,
} from "./domain";
import type {
  OutboxOperation,
  OutboxReceipt,
  OutboxRef,
  OutboxResult,
  RumorFixedOperation,
} from "./domain";
import { OutboxStore } from "./OutboxStore";

const INITIAL_BACKOFF = Duration.seconds(1);
const MAX_BACKOFF = Duration.seconds(60);

const freshJobId = Effect.sync(() => OutboxJobId.make(crypto.randomUUID()));

const fifo = (jobs: ReadonlyArray<StoredOutboxJob>): Array<StoredOutboxJob> =>
  [...jobs].sort((a, b) => a.enqueuedAt - b.enqueuedAt);

const normalizeOperation = (
  operation: RumorFixedOperation,
  clientId: ClientId,
  sentAt: UnixSeconds,
): RumorFixedOperation => {
  switch (operation._tag) {
    case "chat.text":
      return {
        _tag: operation._tag,
        draft: new TextMessageDraft({ ...operation.draft, clientId, sentAt }),
      };
    case "chat.token":
      return {
        _tag: operation._tag,
        draft: new TokenMessageDraft({ ...operation.draft, clientId, sentAt }),
      };
    case "chat.image":
      return {
        _tag: operation._tag,
        draft: new ImageMessageDraft({ ...operation.draft, clientId, sentAt }),
      };
    case "chat.edit":
      return {
        _tag: operation._tag,
        draft: new EditMessageDraft({ ...operation.draft, clientId, sentAt }),
      };
    case "reaction":
      return {
        _tag: operation._tag,
        draft: new ReactionDraft({ ...operation.draft, clientId, sentAt }),
      };
  }
};

const encodeOperationRumor = (
  operation: RumorFixedOperation,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor => {
  switch (operation._tag) {
    case "chat.text":
      return encodeTextMessageRumor(operation.draft, author, sentAt, clientId);
    case "chat.token":
      return encodeTokenMessageRumor(operation.draft, author, sentAt, clientId);
    case "chat.image":
      return encodeImageMessageRumor(operation.draft, author, sentAt, clientId);
    case "chat.edit":
      return encodeEditRumor(operation.draft, author, sentAt, clientId);
    case "reaction":
      return encodeReactionRumor(operation.draft, author, sentAt, clientId);
  }
};

interface OnlineEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const isOnlineEventTarget = (value: unknown): value is OnlineEventTarget =>
  typeof value === "object" &&
  value !== null &&
  "addEventListener" in value &&
  typeof value.addEventListener === "function" &&
  "removeEventListener" in value &&
  typeof value.removeEventListener === "function";

/**
 * Durable send queue over the Chat, Reactions and PaymentTelemetry verticals.
 * `enqueue` persists
 * a normalized job and precomputes its rumor, so the returned `rumorId` is
 * what every delivery retry publishes; a background worker delivers jobs
 * strictly FIFO with invisible backoff retries on delivery errors. Terminal
 * outcomes surface on `results` — a single-consumer stream — and a terminal
 * job is only deleted by `ack`, so unacked terminals re-emit when the service
 * is rebuilt (at-least-once handshake). Jobs stored under a different identity
 * than the current one fail with "identity-changed" at startup; runtime
 * identity changes rebuild the whole runtime, so no live watching is needed.
 */
export class Outbox extends Effect.Service<Outbox>()("linkstr/Outbox", {
  scoped: Effect.gen(function* () {
    const store = yield* OutboxStore;
    const chat = yield* Chat;
    const reactions = yield* Reactions;
    const paymentTelemetry = yield* PaymentTelemetry;
    const identity = yield* LinkstrIdentity;
    const inspector = yield* Inspector.orNoop;

    const terminals = yield* Effect.acquireRelease(
      Queue.unbounded<OutboxResult>(),
      Queue.shutdown,
    );
    const wake = yield* Effect.acquireRelease(
      Queue.sliding<void>(1),
      Queue.shutdown,
    );

    const target: unknown = globalThis;
    if (isOnlineEventTarget(target)) {
      const flush = (): void => {
        Queue.unsafeOffer(wake, undefined);
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => target.addEventListener("online", flush)),
        () => Effect.sync(() => target.removeEventListener("online", flush)),
      );
    }

    const dispatch = (
      operation: OutboxOperation,
    ): Effect.Effect<
      OutboxReceipt,
      RecipientNotReached | NoRelayReachable | WrapNotDelivered
    > => {
      switch (operation._tag) {
        case "chat.text":
          return chat.sendText(operation.draft);
        case "chat.token":
          return chat.sendToken(operation.draft);
        case "chat.image":
          return chat.sendImage(operation.draft);
        case "chat.edit":
          return chat.edit(operation.draft);
        case "reaction":
          return reactions.react(operation.draft);
        case "paymentTelemetry":
          return paymentTelemetry.publishPaymentTelemetry(
            operation.draft,
            operation.recipient,
          );
      }
    };

    const settle = (
      job: StoredOutboxJob,
      result: OutboxResult,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* store.update(
          new StoredOutboxJob({
            ...job,
            state: { _tag: "awaiting-ack", result },
          }),
        );
        yield* Queue.offer(terminals, result);
        inspector.emit(() =>
          result._tag === "OutboxJobSucceeded"
            ? new PlainOperationSucceeded(
                {
                  name: "outbox.job",
                  params: { jobId: job.jobId, ref: job.ref },
                  eventIds: [EventId.make(result.receipt.rumorId)],
                  result,
                },
                { disableValidation: true },
              )
            : new OperationFailed(
                {
                  name: "outbox.job",
                  params: { jobId: job.jobId, ref: job.ref },
                  error: result,
                },
                { disableValidation: true },
              ),
        );
      });

    const runToTerminal = (job: StoredOutboxJob): Effect.Effect<void> =>
      Effect.gen(function* () {
        let backoff = INITIAL_BACKOFF;
        while (true) {
          const attempt = yield* Effect.exit(dispatch(job.operation));
          if (Exit.isSuccess(attempt)) {
            return yield* settle(
              job,
              new OutboxJobSucceeded({
                jobId: job.jobId,
                ref: job.ref,
                receipt: attempt.value,
              }),
            );
          }
          if (Cause.isInterruptedOnly(attempt.cause)) {
            return yield* Effect.interrupt;
          }
          if (Option.isNone(Cause.failureOption(attempt.cause))) {
            return yield* settle(
              job,
              new OutboxJobFailed({
                jobId: job.jobId,
                ref: job.ref,
                reason: "unexpected-error",
                detail: Cause.pretty(attempt.cause),
              }),
            );
          }
          yield* Effect.race(Effect.sleep(backoff), Queue.take(wake));
          backoff = Duration.min(Duration.times(backoff, 2), MAX_BACKOFF);
        }
      });

    const emitStartup = Effect.gen(function* () {
      for (const job of fifo(yield* store.loadAll)) {
        if (job.state._tag === "awaiting-ack") {
          yield* Queue.offer(terminals, job.state.result);
        } else if (job.pubkey !== identity.pubkey) {
          yield* settle(
            job,
            new OutboxJobFailed({
              jobId: job.jobId,
              ref: job.ref,
              reason: "identity-changed",
              detail: `enqueued under ${job.pubkey}, current identity is ${identity.pubkey}`,
            }),
          );
        }
      }
    });

    const nextQueued = Effect.map(store.loadAll, (jobs) =>
      fifo(jobs).find((job) => job.state._tag === "queued"),
    );

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* emitStartup;
        while (true) {
          const job = yield* nextQueued;
          if (job === undefined) yield* Queue.take(wake);
          else yield* runToTerminal(job);
        }
      }),
    );

    const insertJob = (
      operation: OutboxOperation,
      ref: OutboxRef,
    ): Effect.Effect<StoredOutboxJob> =>
      Effect.gen(function* () {
        const job = new StoredOutboxJob({
          jobId: yield* freshJobId,
          ref,
          operation,
          pubkey: identity.pubkey,
          enqueuedAt: yield* nowSeconds,
          state: { _tag: "queued" },
        });
        yield* store.insert(job);
        yield* Queue.offer(wake, undefined);
        return job;
      });

    const enqueue = (
      operation: RumorFixedOperation,
      ref: OutboxRef,
    ): Effect.Effect<EnqueueReceipt> =>
      Effect.gen(function* () {
        const clientId = operation.draft.clientId ?? (yield* freshClientId);
        const sentAt = operation.draft.sentAt ?? (yield* nowSeconds);
        const normalized = normalizeOperation(operation, clientId, sentAt);
        const rumor = encodeOperationRumor(
          normalized,
          identity.pubkey,
          sentAt,
          clientId,
        );
        const job = yield* insertJob(normalized, ref);
        const receipt = new EnqueueReceipt({
          jobId: job.jobId,
          ref,
          rumorId: RumorId.make(rumor.id),
          clientId,
          sentAt,
        });
        inspector.emit(
          () =>
            new PlainOperationSucceeded(
              {
                name: "outbox.enqueue",
                params: { ref, operation: normalized },
                eventIds: [EventId.make(rumor.id)],
                result: receipt,
              },
              { disableValidation: true },
            ),
        );
        return receipt;
      });

    /**
     * Separate from `enqueue` because delivery signs telemetry with a fresh
     * ephemeral author every attempt: there is no rumor id to precompute, and
     * the draft carries its own id and timestamp.
     */
    const enqueueTelemetry = (
      draft: PaymentTelemetryDraft,
      recipient: Pubkey,
      ref: OutboxRef,
    ): Effect.Effect<OutboxJobId> =>
      Effect.gen(function* () {
        const operation: OutboxOperation = {
          _tag: "paymentTelemetry",
          draft,
          recipient,
        };
        const job = yield* insertJob(operation, ref);
        inspector.emit(
          () =>
            new PlainOperationSucceeded(
              {
                name: "outbox.enqueue",
                params: { ref, operation },
                eventIds: [],
                result: { jobId: job.jobId },
              },
              { disableValidation: true },
            ),
        );
        return job.jobId;
      });

    const ack = (jobId: OutboxJobId): Effect.Effect<void> =>
      store.remove(jobId);

    return {
      enqueue,
      enqueueTelemetry,
      /** Terminal outcomes only; single-consumer — fan out downstream. */
      results: Stream.fromQueue(terminals),
      ack,
    } as const;
  }),
}) {}
