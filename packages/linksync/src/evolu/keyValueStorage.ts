import { Option, Schema } from "effect";

/**
 * Synchronous device-local key-value storage, such as a wrapper over
 * `localStorage`. Implementations swallow storage failures: a read that fails
 * returns `null` and a write that fails is dropped.
 */
export interface KeyValueStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export const readJson = <A, I>(
  kv: KeyValueStorage,
  key: string,
  schema: Schema.Codec<A, I>,
  fallback: A,
): A => {
  const raw = kv.getItem(key);
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  return Option.getOrElse(
    Schema.decodeUnknownOption(schema)(parsed),
    () => fallback,
  );
};

export const writeJson = (
  kv: KeyValueStorage,
  key: string,
  value: unknown,
): void => {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    // Circular or non-serializable values are not persisted.
    return;
  }
  kv.setItem(key, raw);
};
