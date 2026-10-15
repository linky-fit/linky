import { Option, Schema } from "effect";
import { KeryxCacheEntry } from "./keryxCache";

// Device-local and re-fetchable; inline data URLs make entries too large for localStorage.
const DB_NAME = "linky.keryxCache";
const STORE_NAME = "companies";

const decodeEntry = Schema.decodeUnknownOption(KeryxCacheEntry);

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const inStore = async <A>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => A,
): Promise<A> => {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const result = run(transaction.objectStore(STORE_NAME));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
};

/** The cached entry of a join origin; null when none is stored or it no longer decodes. */
export const readKeryxCacheEntry = async (
  origin: string,
): Promise<KeryxCacheEntry | null> => {
  const request = await inStore("readonly", (store) => store.get(origin));
  return Option.getOrNull(decodeEntry(request.result));
};

export const writeKeryxCacheEntry = (
  origin: string,
  entry: KeryxCacheEntry,
): Promise<void> =>
  inStore("readwrite", (store) => {
    store.put(entry, origin);
  });

export const deleteKeryxCacheEntry = (origin: string): Promise<void> =>
  inStore("readwrite", (store) => {
    store.delete(origin);
  });
