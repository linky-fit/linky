import type { KeyValueStorage } from "../evolu/keyValueStorage";

/** A `KeyValueStorage` over a map the test can inspect. */
export const memoryKeyValueStorage = (
  initial: Record<string, string> = {},
): KeyValueStorage & { readonly items: Map<string, string> } => {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
};
