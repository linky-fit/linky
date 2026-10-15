import { Effect } from "effect";
import { getUnknownErrorMessage } from "../../utils/unknown";

export type WriteOutcome = { ok: true } | { ok: false; error: string };

/** The outcome of handling that stores nothing. */
export const NO_WRITE: Promise<WriteOutcome> = Promise.resolve({ ok: true });

const failed = (error: unknown): WriteOutcome => ({
  ok: false,
  error: getUnknownErrorMessage(error, "write failed"),
});

/** Runs a repository write; a failure comes back as text for a status line instead of a rejection. */
export const runWrite = (
  write: Effect.Effect<void, unknown>,
): Promise<WriteOutcome> =>
  Effect.runPromise(
    Effect.match(write, {
      onSuccess: (): WriteOutcome => ({ ok: true }),
      onFailure: failed,
    }),
  ).catch(failed);

/** Resolves once every write has finished, with the first failure or success. */
export const allWrites = (
  writes: ReadonlyArray<Promise<WriteOutcome>>,
): Promise<WriteOutcome> =>
  Promise.all(writes).then(
    (outcomes) => outcomes.find((outcome) => !outcome.ok) ?? { ok: true },
  );
