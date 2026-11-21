// Minimal polyfills for Evolu 8 workers on older Safari/WebKit runtimes.
if (typeof Reflect.get(Set.prototype, "difference") !== "function") {
  Object.defineProperty(Set.prototype, "difference", {
    configurable: true,
    writable: true,
    value: function <T>(
      this: Set<T>,
      other: { has(value: T): boolean },
    ): Set<T> {
      const result = new Set<T>();
      for (const value of this) {
        if (!other.has(value)) result.add(value);
      }
      return result;
    },
  });
}

if (typeof Reflect.get(Promise, "withResolvers") !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

if (typeof Reflect.get(Array.prototype, "toSorted") !== "function") {
  Object.defineProperty(Array.prototype, "toSorted", {
    configurable: true,
    writable: true,
    value: function <T>(
      this: ReadonlyArray<T>,
      compareFn?: (a: T, b: T) => number,
    ): T[] {
      return [...this].sort(compareFn);
    },
  });
}
