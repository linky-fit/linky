type LockCallback<T> = (lock: Lock | null) => T | PromiseLike<T>;

interface LockOptions {
  readonly ifAvailable?: boolean;
}

/** The part of the Web Locks API (`navigator.locks`) the app calls. */
export interface SingleContextLocks {
  readonly request: {
    <T>(name: string, callback: LockCallback<T>): Promise<Awaited<T>>;
    <T>(
      name: string,
      options: LockOptions,
      callback: LockCallback<T>,
    ): Promise<Awaited<T>>;
  };
  readonly query: () => Promise<LockManagerSnapshot>;
}

/**
 * Exclusive Web Locks for a runtime with one JavaScript context, as on
 * React Native: requests for a name run one at a time in request order, and
 * `ifAvailable` gets `null` instead of waiting.
 */
export const makeSingleContextLocks = (): SingleContextLocks => {
  const tails = new Map<string, Promise<void>>();
  const held = new Set<string>();
  const pending = new Map<string, number>();

  const run = async <T>(
    name: string,
    callback: LockCallback<T>,
  ): Promise<Awaited<T>> => {
    const previous = tails.get(name) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => (release = resolve));
    tails.set(name, tail);
    pending.set(name, (pending.get(name) ?? 0) + 1);
    await previous;
    pending.set(name, (pending.get(name) ?? 1) - 1);
    held.add(name);
    try {
      return await callback({ name, mode: "exclusive" });
    } finally {
      held.delete(name);
      if (tails.get(name) === tail) tails.delete(name);
      release();
    }
  };

  const request = <T>(
    name: string,
    optionsOrCallback: LockOptions | LockCallback<T>,
    maybeCallback?: LockCallback<T>,
  ): Promise<Awaited<T>> => {
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;
    if (callback === undefined)
      return Promise.reject(new TypeError("A lock request needs a callback"));
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    if (options.ifAvailable === true && tails.has(name))
      return Promise.resolve(callback(null));
    return run(name, callback);
  };

  return {
    request,
    query: () =>
      Promise.resolve({
        held: Array.from(held, (name) => ({
          name,
          mode: "exclusive" as const,
        })),
        pending: Array.from(pending).flatMap(([name, count]) =>
          Array.from({ length: count }, () => ({
            name,
            mode: "exclusive" as const,
          })),
        ),
      }),
  };
};
