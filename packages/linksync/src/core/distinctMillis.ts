const MAX_LEAD_MS = 1_000;

/**
 * A row's `createdAt` is the millisecond of its write, and the app orders
 * messages of one second by it. Returns a clock that never gives the same
 * millisecond twice, running ahead of the real one by at most a second
 * under a burst of writes; at that lead it repeats instead of drifting.
 */
export const distinctMillis = (): ((realMillis: number) => number) => {
  let last = 0;
  return (realMillis) => {
    last = Math.max(realMillis, Math.min(last + 1, realMillis + MAX_LEAD_MS));
    return last;
  };
};
