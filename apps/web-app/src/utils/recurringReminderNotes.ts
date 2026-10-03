import { Schema } from "effect";

const DB_NAME = "linky.recurringReminderNotes";
const STORE_NAME = "notes";

/** Per reminder time, the note of each recurring payment due then; null for one without a note. */
export type RecurringReminderNotes = ReadonlyMap<
  number,
  ReadonlyArray<string | null>
>;

const isNotes = Schema.is(Schema.Array(Schema.NullOr(Schema.String)));

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

/** Replaces every stored reminder time with `notes`. */
export const storeRecurringReminderNotes = (
  notes: RecurringReminderNotes,
): Promise<void> =>
  inStore("readwrite", (store) => {
    store.clear();
    for (const [notifyAtSec, orderNotes] of notes) {
      store.put(orderNotes, notifyAtSec);
    }
  });

/** The notes stored for `notifyAtSec`; null when this device stored none. */
export const readRecurringReminderNotes = async (
  notifyAtSec: number,
): Promise<ReadonlyArray<string | null> | null> => {
  const request = await inStore("readonly", (store) => store.get(notifyAtSec));
  const notes: unknown = request.result;
  return isNotes(notes) ? notes : null;
};
