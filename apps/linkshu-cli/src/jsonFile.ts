import { Data, Effect, Schedule, Schema } from "effect";
import * as fs from "node:fs";

/**
 * A JSON file two processes may read-modify-write concurrently.
 *
 * Both file-backed ports are built on this, so all durability lives in one
 * place: `read` is a plain parse, and `modify` is the only writer — it holds
 * an exclusive lock, re-reads the freshest contents, and replaces the file in
 * a single atomic rename. A reader therefore never observes a half-written
 * file, and a lost update is impossible as long as every writer goes through
 * `modify`.
 */
export interface JsonFile<A> {
  /** Current contents, or the empty value when the file does not exist. */
  readonly read: Effect.Effect<A>;
  /** Locked read-modify-write; `change` returns the next contents and a result. */
  readonly modify: <B>(
    change: (current: A) => readonly [A, B],
  ) => Effect.Effect<B>;
}

/** A lock file older than this belongs to a process that died holding it. */
const LOCK_STALE_MS = 30_000;

const LOCK_RETRY = { schedule: Schedule.spaced("20 millis"), times: 500 };

class LockContended extends Data.TaggedError("LockContended")<{
  readonly lockPath: string;
}> {}

const isStale = (mtimeMs: number): boolean =>
  Date.now() - mtimeMs > LOCK_STALE_MS;

/**
 * Renaming the lock aside claims it atomically, so of two waiters that both
 * find it stale only one breaks it — two bare `rm`s could race, with the
 * second deleting a lock the first had already re-acquired. If the rename
 * grabbed a lock that had just been re-created fresh, it is put back.
 */
const breakStaleLock = (lockPath: string): void => {
  const claimPath = `${lockPath}.${process.pid}.stale`;
  try {
    if (!isStale(fs.statSync(lockPath).mtimeMs)) return;
    fs.renameSync(lockPath, claimPath);
    if (isStale(fs.statSync(claimPath).mtimeMs)) fs.rmSync(claimPath);
    else fs.renameSync(claimPath, lockPath);
  } catch {
    // Another process released or broke it first; the next attempt decides.
  }
};

/** `wx` fails rather than truncates when the file exists, which is the lock. */
const tryLock = (lockPath: string): boolean => {
  try {
    fs.closeSync(fs.openSync(lockPath, "wx"));
    return true;
  } catch (error) {
    const contended =
      error instanceof Error && "code" in error && error.code === "EEXIST";
    if (!contended) throw error;
    breakStaleLock(lockPath);
    return false;
  }
};

const withLock = <A>(
  lockPath: string,
  body: Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.acquireUseRelease(
    Effect.suspend(() =>
      tryLock(lockPath) ? Effect.void : new LockContended({ lockPath }),
    ).pipe(Effect.retry(LOCK_RETRY), Effect.orDie),
    () => body,
    () =>
      Effect.sync(() => {
        fs.rmSync(lockPath, { force: true });
      }),
  );

const writeAtomically = (filePath: string, contents: string): void => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, contents, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
};

/**
 * Contents that exist but do not decode are a defect, never an empty wallet:
 * silently starting over would look exactly like losing every token.
 */
export const makeJsonFile = <A, I>(
  filePath: string,
  schema: Schema.Codec<A, I>,
  empty: A,
): JsonFile<A> => {
  const json = Schema.fromJsonString(schema, { space: 2 });
  const decode = Schema.decodeUnknownSync(json);
  const encode = Schema.encodeSync(json);
  const lockPath = `${filePath}.lock`;

  const readFile = (): A =>
    fs.existsSync(filePath) ? decode(fs.readFileSync(filePath, "utf8")) : empty;

  return {
    read: Effect.sync(readFile),
    modify: (change) =>
      withLock(
        lockPath,
        Effect.sync(() => {
          const [next, result] = change(readFile());
          writeAtomically(filePath, encode(next));
          return result;
        }),
      ),
  };
};
