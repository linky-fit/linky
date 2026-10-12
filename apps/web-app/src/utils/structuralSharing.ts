const shallowEqual = <T extends object>(a: T, b: T): boolean => {
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  for (const key in a) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
};

/** The same items in the same order. */
export const sameItems = <T>(
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * `next` with each row whose fields all equal those of the previous row with
 * its id replaced by that previous row, so memoized views of it stay put;
 * `previous` itself when no row changed. Rows hold only primitive fields.
 */
export const keepUnchangedRows = <T extends { readonly id: string }>(
  previous: T[] | undefined,
  next: T[],
): T[] => {
  if (!previous) return next;
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const shared = next.map((row) => {
    const before = previousById.get(row.id);
    return before && shallowEqual(before, row) ? before : row;
  });
  return sameItems(previous, shared) ? previous : shared;
};

/**
 * `next` with each list holding the same items as the previous list under its
 * key replaced by that list; `previous` itself when no list changed.
 */
export const keepUnchangedLists = <K, T>(
  previous: ReadonlyMap<K, T[]> | undefined,
  next: Map<K, T[]>,
): ReadonlyMap<K, T[]> => {
  if (!previous) return next;
  let changed = previous.size !== next.size;
  for (const [key, list] of next) {
    const before = previous.get(key);
    if (before && sameItems(before, list)) next.set(key, before);
    else changed = true;
  }
  return changed ? next : previous;
};
