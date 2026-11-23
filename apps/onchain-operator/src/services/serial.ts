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
