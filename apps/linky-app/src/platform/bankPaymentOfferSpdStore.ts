/** A stored offer record, under the offer id it is kept by. */
export interface StoredSpdRecord {
  offerId: string;
  value: unknown;
}

/** What `updateSpdRecords` writes back, and what it resolves with. */
export interface SpdRecordsChange<A> {
  put: readonly { offerId: string }[];
  remove: readonly string[];
  result: A;
}

const SPD_DB_NAME = "linky.bank_payment_offer_spd";
const SPD_STORE_NAME = "offers";

const openSpdDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SPD_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SPD_STORE_NAME, { keyPath: "offerId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Reads every stored offer record, writes back what `change` returns and
 * resolves once that committed. localStorage writes are flushed
 * asynchronously and a killed WebKit loses the last ones; a committed
 * IndexedDB transaction survives the kill.
 */
export const updateSpdRecords = async <A>(
  change: (stored: readonly StoredSpdRecord[]) => SpdRecordsChange<A>,
): Promise<A> => {
  const db = await openSpdDb();
  try {
    const transaction = db.transaction(SPD_STORE_NAME, "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore(SPD_STORE_NAME);
    const stored: StoredSpdRecord[] = [];
    const committed: { outcome: { result: A } | null } = { outcome: null };
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        stored.push({ offerId: String(cursor.key), value: cursor.value });
        cursor.continue();
        return;
      }
      const { put, remove, result } = change(stored);
      for (const record of put) store.put(record);
      for (const offerId of remove) store.delete(offerId);
      committed.outcome = { result };
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    if (committed.outcome === null) throw new Error("spd-store-read-failed");
    return committed.outcome.result;
  } finally {
    db.close();
  }
};
