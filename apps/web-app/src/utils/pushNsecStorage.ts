import { asNonEmptyString } from "./validation";
const PUSH_NSEC_DB_NAME = "linky-push-secrets-v1";
const PUSH_NSEC_DB_VERSION = 1;
const PUSH_NSEC_STORE_NAME = "kv";
const PUSH_NSEC_KEY = "nostr_nsec";

function canUseIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openPushNsecDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_NSEC_DB_NAME, PUSH_NSEC_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PUSH_NSEC_STORE_NAME)) {
        db.createObjectStore(PUSH_NSEC_STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open push nsec database"));
    };
  });
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
  });
}

export async function setStoredPushNsec(nsec: string): Promise<void> {
  const normalized = asNonEmptyString(nsec);
  if (!normalized || !canUseIndexedDb()) {
    return;
  }

  const db = await openPushNsecDb();
  try {
    const transaction = db.transaction(PUSH_NSEC_STORE_NAME, "readwrite");
    transaction
      .objectStore(PUSH_NSEC_STORE_NAME)
      .put(normalized, PUSH_NSEC_KEY);
    await awaitTransaction(transaction);
  } finally {
    db.close();
  }
}

export async function getStoredPushNsec(): Promise<string | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  const db = await openPushNsecDb();
  try {
    const transaction = db.transaction(PUSH_NSEC_STORE_NAME, "readonly");
    const value = await awaitRequest(
      transaction.objectStore(PUSH_NSEC_STORE_NAME).get(PUSH_NSEC_KEY),
    );
    await awaitTransaction(transaction);
    return typeof value === "string" ? asNonEmptyString(value) : null;
  } finally {
    db.close();
  }
}

export async function clearStoredPushNsec(): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }

  const db = await openPushNsecDb();
  try {
    const transaction = db.transaction(PUSH_NSEC_STORE_NAME, "readwrite");
    transaction.objectStore(PUSH_NSEC_STORE_NAME).delete(PUSH_NSEC_KEY);
    await awaitTransaction(transaction);
  } finally {
    db.close();
  }
}
