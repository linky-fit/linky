/**
 * Minimal synchronous string key-value storage. The web `localStorage`
 * satisfies it as-is; other platforms adapt their own storage.
 */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StringStorageCodec<A> {
  /** Null for an unreadable stored value. */
  readonly decode: (raw: string) => A | null;
  readonly encode: (value: A) => string;
}

/** One typed value living under one storage key. */
export const stringStorageSlot = <A>(
  storage: StringStorage,
  key: string,
  codec: StringStorageCodec<A>,
) => ({
  read: (): A | null => {
    const raw = storage.getItem(key);
    return raw === null ? null : codec.decode(raw);
  },
  write: (value: A): void => {
    storage.setItem(key, codec.encode(value));
  },
});
