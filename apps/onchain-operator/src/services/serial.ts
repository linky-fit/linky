/** Runs tasks one after another; a failed task is logged, resolves `undefined` and does not stop the next. */
export const serialQueue = (label: string) => {
  let queue: Promise<void> = Promise.resolve();
  return <A>(task: () => Promise<A>): Promise<A | undefined> => {
    const next = queue.then(task).catch((error: unknown) => {
      console.warn(`[onchain-operator] ${label} failed`, error);
      return undefined;
    });
    queue = next.then(() => undefined);
    return next;
  };
};

/** Runs tasks one after another; a failed task rejects for its caller and does not stop the next. */
export const exclusive = () => {
  let queue: Promise<void> = Promise.resolve();
  return <A>(task: () => Promise<A>): Promise<A> => {
    const next = queue.then(task);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
};
