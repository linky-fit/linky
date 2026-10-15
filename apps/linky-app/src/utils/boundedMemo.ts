/**
 * Remembers a pure function's result per input, for the `capacity` inputs
 * seen last; the oldest input is forgotten first.
 */
export const boundedMemo = <A>(
  compute: (input: string) => A,
  capacity: number,
): ((input: string) => A) => {
  const results = new Map<string, { readonly value: A }>();
  return (input) => {
    const cached = results.get(input);
    if (cached) return cached.value;
    const value = compute(input);
    if (results.size >= capacity) {
      const oldest = results.keys().next();
      if (!oldest.done) results.delete(oldest.value);
    }
    results.set(input, { value });
    return value;
  };
};
