import { Effect } from "effect";
import { getUnknownErrorMessage } from "../../utils/unknown";

export type WriteOutcome = { ok: true } | { ok: false; error: string };

/** Runs a repository write; a failure comes back as text for a status line instead of a rejection. */
export const runWrite = (
  write: Effect.Effect<void, unknown>,
): Promise<WriteOutcome> =>
  Effect.runPromise(write).then(
    (): WriteOutcome => ({ ok: true }),
    (error: unknown): WriteOutcome => ({
      ok: false,
      error: getUnknownErrorMessage(error, "write failed"),
    }),
  );
