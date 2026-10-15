import { Schema } from "effect";
import { createContactNameFormatter, getContactName } from "./contactName";
import { asNonEmptyString } from "./validation";
const PUSH_CONTACT_NAMES_DB_NAME = "linky-push-contact-names-v1";
const PUSH_CONTACT_NAMES_DB_VERSION = 1;
const PUSH_CONTACT_NAMES_STORE_NAME = "contacts";

interface PushContactNameRecordInput {
  name: string;
  nameSetByUser?: boolean;
  npub: string;
  pubkey: string;
}

const StoredPushContactNameRecord = Schema.Struct({
  name: Schema.String,
  nameSetByUser: Schema.optional(Schema.Boolean),
  npub: Schema.String,
  pubkey: Schema.String,
  updatedAt: Schema.Number,
});
type StoredPushContactNameRecord = typeof StoredPushContactNameRecord.Type;
const isStoredPushContactNameRecord = Schema.is(StoredPushContactNameRecord);

function canUseIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openPushContactNamesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      PUSH_CONTACT_NAMES_DB_NAME,
      PUSH_CONTACT_NAMES_DB_VERSION,
    );

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PUSH_CONTACT_NAMES_STORE_NAME)) {
        db.createObjectStore(PUSH_CONTACT_NAMES_STORE_NAME, {
          keyPath: "pubkey",
        });
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
      reject(
        request.error ??
          new Error("Failed to open push contact names database"),
      );
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

export async function setStoredPushContactNames(
  contacts: readonly PushContactNameRecordInput[],
): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }

  const records: StoredPushContactNameRecord[] = [];
  const seenPubkeys = new Set<string>();
  const updatedAt = Date.now();

  for (const contact of contacts) {
    const pubkey = asNonEmptyString(contact.pubkey);
    const npub = asNonEmptyString(contact.npub);
    const name = getContactName(contact);
    if (!pubkey || !npub || !name) continue;
    if (seenPubkeys.has(pubkey)) continue;

    seenPubkeys.add(pubkey);
    records.push({
      name,
      npub,
      pubkey,
      updatedAt,
      nameSetByUser: contact.nameSetByUser === true,
    });
  }

  const db = await openPushContactNamesDb();
  try {
    const transaction = db.transaction(
      PUSH_CONTACT_NAMES_STORE_NAME,
      "readwrite",
    );
    const store = transaction.objectStore(PUSH_CONTACT_NAMES_STORE_NAME);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    await awaitTransaction(transaction);
  } finally {
    db.close();
  }
}

export async function getStoredPushContactName(
  pubkey: string,
): Promise<string | null> {
  const normalizedPubkey = asNonEmptyString(pubkey);
  if (!normalizedPubkey || !canUseIndexedDb()) {
    return null;
  }

  const db = await openPushContactNamesDb();
  try {
    const transaction = db.transaction(
      PUSH_CONTACT_NAMES_STORE_NAME,
      "readonly",
    );
    const value: unknown = await awaitRequest(
      transaction.objectStore(PUSH_CONTACT_NAMES_STORE_NAME).getAll(),
    );
    await awaitTransaction(transaction);
    const records = Schema.is(Schema.Array(Schema.Unknown))(value)
      ? value.filter(isStoredPushContactNameRecord)
      : [];
    const contact = records.find(
      (record) => record.pubkey === normalizedPubkey,
    );
    return contact
      ? createContactNameFormatter(records)(contact) || null
      : null;
  } finally {
    db.close();
  }
}
