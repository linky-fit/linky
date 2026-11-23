import { Context, Effect, Layer, Result, Schema } from "effect";
import { stringStorageSlot } from "../internal/stringStorage";
import type { StringStorage } from "../internal/stringStorage";
import { PersistedOutboxJob } from "./domain";
import type { OutboxJobId, StoredOutboxJob } from "./domain";

export interface OutboxStoreService {
  readonly insert: (job: StoredOutboxJob) => Effect.Effect<void>;
  readonly update: (job: StoredOutboxJob) => Effect.Effect<void>;
  readonly remove: (jobId: OutboxJobId) => Effect.Effect<void>;
  /** Jobs in insertion order. */
  readonly loadAll: Effect.Effect<ReadonlyArray<StoredOutboxJob>>;
}

const StoredRawJobsJson = Schema.fromJsonString(Schema.Array(Schema.Unknown));
const decodeRawJobs = Schema.decodeUnknownResult(StoredRawJobsJson);
const decodeJob = Schema.decodeUnknownResult(PersistedOutboxJob);
const encodeJobs = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(PersistedOutboxJob)),
);

const decodeJobs = (raw: string): ReadonlyArray<StoredOutboxJob> => {
  const rawItems = decodeRawJobs(raw);
  if (Result.isFailure(rawItems)) return [];
  const jobs: StoredOutboxJob[] = [];
  for (const item of rawItems.success) {
    const decoded = decodeJob(item);
    if (Result.isSuccess(decoded)) jobs.push(decoded.success);
  }
  return jobs;
};

const makeInMemory = (): OutboxStoreService => {
  const jobs = new Map<string, StoredOutboxJob>();
  const put = (job: StoredOutboxJob): Effect.Effect<void> =>
    Effect.sync(() => {
      jobs.set(job.jobId, job);
    });
  return {
    insert: put,
    update: put,
    remove: (jobId) =>
      Effect.sync(() => {
        jobs.delete(jobId);
      }),
    loadAll: Effect.sync(() => [...jobs.values()]),
  };
};

const makeStringStorage = (
  storage: StringStorage,
  key: string,
): OutboxStoreService => {
  const slot = stringStorageSlot<ReadonlyArray<StoredOutboxJob>>(storage, key, {
    decode: decodeJobs,
    encode: encodeJobs,
  });
  const load = (): ReadonlyArray<StoredOutboxJob> => slot.read() ?? [];
  const save = slot.write;
  return {
    insert: (job) => Effect.sync(() => save([...load(), job])),
    update: (job) =>
      Effect.sync(() =>
        save(
          load().map((stored) => (stored.jobId === job.jobId ? job : stored)),
        ),
      ),
    remove: (jobId) =>
      Effect.sync(() =>
        save(load().filter((stored) => stored.jobId !== jobId)),
      ),
    loadAll: Effect.sync(load),
  };
};

/** Storage port of the outbox: one durable, insertion-ordered job list. */
export class OutboxStore extends Context.Service<
  OutboxStore,
  OutboxStoreService
>()("linkstr/OutboxStore") {
  /** Non-durable; for tests and as the platform-agnostic default. */
  static readonly inMemory: Layer.Layer<OutboxStore> = Layer.sync(
    OutboxStore,
    makeInMemory,
  );

  /**
   * One storage key holding the JSON-encoded job array; an unreadable stored
   * value decodes as an empty list, and corrupt entries in a stored array are
   * skipped. Platform code supplies the storage (web: `localStorage`).
   */
  static fromStringStorage(
    storage: StringStorage,
    key: string,
  ): Layer.Layer<OutboxStore> {
    return Layer.sync(OutboxStore, () => makeStringStorage(storage, key));
  }
}
