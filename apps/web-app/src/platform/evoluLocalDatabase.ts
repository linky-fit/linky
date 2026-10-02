import { Schema } from "effect";
import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
} from "../utils/storage";

const PENDING_WIPES_STORAGE_KEY = "linky.evoluDatabaseWipes.v1";
const PendingWipes = Schema.Array(Schema.String);
const WORKER_LOCK_WAIT_MS = 5_000;

export const evoluDbNameFor = (mnemonic: string | null): string => {
  if (!mnemonic) return "linky-anon";
  let hash = 0;
  for (let i = 0; i < mnemonic.length; i++) {
    hash = ((hash << 5) - hash + mnemonic.charCodeAt(i)) | 0;
  }
  return `linky-${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
};

export const activeEvoluDbName = (): string =>
  evoluDbNameFor(safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY));

const readPendingWipes = (): readonly string[] =>
  safeLocalStorageGetJson(PENDING_WIPES_STORAGE_KEY, PendingWipes, []);

const writePendingWipes = (dbNames: readonly string[]): void => {
  if (dbNames.length === 0) safeLocalStorageRemove(PENDING_WIPES_STORAGE_KEY);
  else safeLocalStorageSetJson(PENDING_WIPES_STORAGE_KEY, dbNames);
};

/**
 * Marks the open database for deletion on the next boot. It can't be deleted
 * now: this tab's Evolu worker holds its files open and Evolu 7 cannot close.
 */
export const scheduleActiveEvoluDatabaseWipe = (): void => {
  const dbName = activeEvoluDbName();
  const pending = readPendingWipes();
  if (!pending.includes(dbName)) writePendingWipes([...pending, dbName]);
};

const isNotFoundError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "NotFoundError";

// @evolu/web runs a database's worker only in the tab holding this lock, and
// its OPFS SAH pool VFS keeps the database files in the directory `.<name>`.
const deleteDatabaseFiles = async (dbName: string): Promise<void> => {
  await navigator.locks.request(
    `evolu-sharedwebworker-${dbName}`,
    { signal: AbortSignal.timeout(WORKER_LOCK_WAIT_MS) },
    async () => {
      const root = await navigator.storage.getDirectory();
      await root
        .removeEntry(`.${dbName}`, { recursive: true })
        .catch((error: unknown) => {
          if (!isNotFoundError(error)) throw error;
        });
    },
  );
};

/**
 * Deletes the databases of accounts logged out on this device. A database
 * another tab still has open stays scheduled for a later boot; the active one
 * is dropped from the schedule because the user logged back into it.
 */
export const wipeScheduledEvoluDatabases = async (): Promise<void> => {
  const activeDbName = activeEvoluDbName();
  const scheduled = readPendingWipes().filter((name) => name !== activeDbName);
  if (scheduled.length === 0) {
    writePendingWipes([]);
    return;
  }

  const wiped: string[] = [];
  const failed: string[] = [];
  for (const dbName of scheduled) {
    try {
      await deleteDatabaseFiles(dbName);
      wiped.push(dbName);
    } catch {
      failed.push(dbName);
    }
  }
  writePendingWipes(failed);

  reportAppLog({
    tag: "evolu.loggedOutDatabasesWiped",
    summary: `Deleted ${wiped.length} logged-out local databases; ${failed.length} stay scheduled`,
    payload: { wiped, failed },
  });
};
