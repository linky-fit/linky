import { identity, Predicate, Schema } from "effect";
import {
  ChatMessageReceipt,
  EditMessageDraft,
  ImageMessageDraft,
  MessageEditReceipt,
  TextMessageDraft,
  TokenMessageDraft,
} from "../chat/domain";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import {
  PaymentTelemetryDraft,
  PaymentTelemetryReceipt,
} from "../paymentTelemetry/domain";
import { ReactionDraft, ReactionReceipt } from "../reactions/domain";

export const OutboxJobId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("OutboxJobId"),
);
export type OutboxJobId = typeof OutboxJobId.Type;

/** Opaque app correlation id (e.g. the app's DB row id), echoed on results. */
export const OutboxRef = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("OutboxRef"),
);
export type OutboxRef = typeof OutboxRef.Type;

export const ChatTextOperation = Schema.TaggedStruct("chat.text", {
  draft: TextMessageDraft,
});
export type ChatTextOperation = typeof ChatTextOperation.Type;

export const ChatTokenOperation = Schema.TaggedStruct("chat.token", {
  draft: TokenMessageDraft,
});
export type ChatTokenOperation = typeof ChatTokenOperation.Type;

export const ChatImageOperation = Schema.TaggedStruct("chat.image", {
  draft: ImageMessageDraft,
});
export type ChatImageOperation = typeof ChatImageOperation.Type;

export const ChatEditOperation = Schema.TaggedStruct("chat.edit", {
  draft: EditMessageDraft,
});
export type ChatEditOperation = typeof ChatEditOperation.Type;

export const ReactionOperation = Schema.TaggedStruct("reaction", {
  draft: ReactionDraft,
});
export type ReactionOperation = typeof ReactionOperation.Type;

export const PaymentTelemetryOperation = Schema.TaggedStruct(
  "paymentTelemetry",
  {
    draft: PaymentTelemetryDraft,
    recipient: Pubkey,
  },
);
export type PaymentTelemetryOperation = typeof PaymentTelemetryOperation.Type;

export const OutboxOperation = Schema.Union(
  ChatTextOperation,
  ChatTokenOperation,
  ChatImageOperation,
  ChatEditOperation,
  ReactionOperation,
  PaymentTelemetryOperation,
);
export type OutboxOperation = typeof OutboxOperation.Type;

/**
 * Operations whose rumor is fully determined at enqueue time, so every retry
 * republishes the same rumor id. Telemetry is the exception: it mints a fresh
 * ephemeral author per attempt.
 */
export type RumorFixedOperation = Exclude<
  OutboxOperation,
  PaymentTelemetryOperation
>;

export class EnqueueReceipt extends Schema.TaggedClass<EnqueueReceipt>()(
  "EnqueueReceipt",
  {
    jobId: OutboxJobId,
    ref: OutboxRef,
    /** Deterministic: every delivery retry publishes this exact rumor id. */
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
  },
) {}

export const OutboxReceipt = Schema.Union(
  ChatMessageReceipt,
  MessageEditReceipt,
  ReactionReceipt,
  PaymentTelemetryReceipt,
);
export type OutboxReceipt = typeof OutboxReceipt.Type;

export const OutboxFailureReason = Schema.Literal(
  "identity-changed",
  "unexpected-error",
);
export type OutboxFailureReason = typeof OutboxFailureReason.Type;

export class OutboxJobSucceeded extends Schema.TaggedClass<OutboxJobSucceeded>()(
  "OutboxJobSucceeded",
  {
    jobId: OutboxJobId,
    ref: OutboxRef,
    receipt: OutboxReceipt,
  },
) {}

export class OutboxJobFailed extends Schema.TaggedClass<OutboxJobFailed>()(
  "OutboxJobFailed",
  {
    jobId: OutboxJobId,
    ref: OutboxRef,
    reason: OutboxFailureReason,
    detail: Schema.String,
  },
) {}

export const OutboxResult = Schema.Union(OutboxJobSucceeded, OutboxJobFailed);
export type OutboxResult = typeof OutboxResult.Type;

export const OutboxJobState = Schema.Union(
  Schema.TaggedStruct("queued", {}),
  Schema.TaggedStruct("awaiting-ack", { result: OutboxResult }),
);
export type OutboxJobState = typeof OutboxJobState.Type;

export class StoredOutboxJob extends Schema.Class<StoredOutboxJob>(
  "StoredOutboxJob",
)({
  jobId: OutboxJobId,
  ref: OutboxRef,
  /** Normalized at enqueue: `clientId` and `sentAt` are filled in. */
  operation: OutboxOperation,
  /** Identity the job was enqueued under; never sent under another key. */
  pubkey: Pubkey,
  enqueuedAt: UnixSeconds,
  state: OutboxJobState,
}) {}

const receiptTagOf = (
  operationTag: unknown,
): OutboxReceipt["_tag"] | undefined => {
  switch (operationTag) {
    case "chat.text":
    case "chat.token":
    case "chat.image":
      return "ChatMessageReceipt";
    case "chat.edit":
      return "MessageEditReceipt";
    case "reaction":
      return "ReactionReceipt";
    case "paymentTelemetry":
      return "PaymentTelemetryReceipt";
    default:
      return undefined;
  }
};

const LEGACY_RUMOR_ID_KEYS = ["messageId", "reactionId", "telemetryId"];

const withRumorIdKey = (
  receipt: Record<string, unknown>,
): Record<string, unknown> => {
  const legacyKey = LEGACY_RUMOR_ID_KEYS.find((key) => key in receipt);
  if (legacyKey === undefined) return receipt;
  const { [legacyKey]: rumorId, ...rest } = receipt;
  return { ...rest, rumorId };
};

/**
 * Two older generations of persisted receipts still decode: receipts without
 * a `_tag` (the job's operation names the kind), and before that receipts
 * keyed by a per-vertical id (`messageId`, `reactionId`, `telemetryId`)
 * instead of `rumorId`.
 */
const upgradeLegacyReceipt = (
  job: Record<string, unknown>,
): Record<string, unknown> => {
  const { operation, state } = job;
  if (!Predicate.isRecord(operation) || !Predicate.isRecord(state)) return job;
  const { result } = state;
  if (!Predicate.isRecord(result)) return job;
  const { receipt } = result;
  if (!Predicate.isRecord(receipt) || "_tag" in receipt) return job;
  const _tag = receiptTagOf(operation._tag);
  if (_tag === undefined) return job;
  return {
    ...job,
    state: {
      ...state,
      result: { ...result, receipt: { _tag, ...withRumorIdKey(receipt) } },
    },
  };
};

const UnknownRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

/** `StoredOutboxJob` as read from storage, upgrading legacy receipts first. */
export const PersistedOutboxJob = Schema.compose(
  Schema.transform(UnknownRecord, UnknownRecord, {
    strict: true,
    decode: upgradeLegacyReceipt,
    encode: identity,
  }),
  StoredOutboxJob,
  { strict: false },
);
