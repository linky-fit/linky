import {
  parseCollectedInspectorRow,
  type CollectedInspectorRow,
} from "./inspectorRows";

const DATABASE_NAME = "linky.inspector_logs";
const DATABASE_VERSION = 1;
const ROW_STORE_NAME = "rows";

interface InspectorLogStorageMutation {
  appendedRows: CollectedInspectorRow[];
  deletedRows: CollectedInspectorRow[];
}

interface InspectorLogStorage {
  apply: (mutation: InspectorLogStorageMutation) => Promise<void>;
  clear: () => Promise<void>;
  load: () => Promise<CollectedInspectorRow[]>;
}

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Inspector log transaction failed"),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Inspector log transaction aborted"),
      );
  });

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ROW_STORE_NAME)) {
        database.createObjectStore(ROW_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Could not open inspector log storage"),
      );
  });

const loadRows = async (
  database: IDBDatabase,
): Promise<CollectedInspectorRow[]> => {
  const transaction = database.transaction(ROW_STORE_NAME, "readonly");
  const store = transaction.objectStore(ROW_STORE_NAME);
  const rows: CollectedInspectorRow[] = [];
  const done = transactionDone(transaction);

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve();
        return;
      }
      const value: unknown = cursor.value;
      const row = parseCollectedInspectorRow(value);
      if (row) rows.push(row);
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read inspector logs"));
  });
  await done;
  return rows;
};

export const indexedDbInspectorLogStorage: InspectorLogStorage = {
  async apply({ appendedRows, deletedRows }) {
    if (appendedRows.length === 0 && deletedRows.length === 0) return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(ROW_STORE_NAME, "readwrite");
      const store = transaction.objectStore(ROW_STORE_NAME);
      for (const row of deletedRows) store.delete(row.id);
      for (const row of appendedRows) store.put(row);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },

  async clear() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(ROW_STORE_NAME, "readwrite");
      transaction.objectStore(ROW_STORE_NAME).clear();
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },

  async load() {
    const database = await openDatabase();
    try {
      return await loadRows(database);
    } finally {
      database.close();
    }
  },
};
