import { sleep } from "../utils/time";
import {
  safeLocalStorageClear,
  safeLocalStorageGet,
  safeLocalStorageSet,
  safeSessionStorageClear,
} from "../utils/storage";

const LOGOUT_PENDING_STORAGE_KEY = "linky.logoutPending";
const WIPE_DEADLINE_MS = 10_000;
const RETRY_DELAY_MS = 250;
const IDB_DELETE_WAIT_MS = 1_000;

export const isLogoutPending = (): boolean =>
  safeLocalStorageGet(LOGOUT_PENDING_STORAGE_KEY) === "1";

/**
 * Every tab, this one included, has to reload after this: a booting tab sees
 * the pending logout and wipes before it opens Evolu, whose worker would
 * otherwise keep the database files open.
 */
export const markLogoutPending = (): void =>
  safeLocalStorageSet(LOGOUT_PENDING_STORAGE_KEY, "1");

export const onLogoutInAnotherTab = (callback: () => void): void => {
  window.addEventListener("storage", (event) => {
    if (event.key === LOGOUT_PENDING_STORAGE_KEY && event.newValue) callback();
  });
};

const untilDeadline = async (
  deadline: number,
  attempt: () => Promise<void>,
): Promise<void> => {
  for (;;) {
    try {
      return await attempt();
    } catch {
      if (Date.now() >= deadline) {
        throw new Error("Close other Linky tabs to finish logging out.");
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
};

// A tab that hasn't finished unloading still holds its Evolu files open.
const removeOpfsEntries = async (): Promise<void> => {
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;
  // @ts-expect-error OPFS FileSystemDirectoryHandle.keys() not yet in all TS libs
  for await (const name of root.keys()) {
    await root.removeEntry(name, { recursive: true });
  }
};

const deleteIndexedDb = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

const deleteIndexedDbs = async (): Promise<void> => {
  const databases = (await indexedDB.databases?.()) ?? [];
  // The service worker keeps workbox-expiration open, which blocks its delete
  // with no further event until the unregistered worker stops.
  await Promise.all(
    databases.flatMap(({ name }) =>
      name
        ? [Promise.race([deleteIndexedDb(name), sleep(IDB_DELETE_WAIT_MS)])]
        : [],
    ),
  );
};

const deleteCacheStorage = async (): Promise<void> => {
  if (!("caches" in globalThis)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
};

const unregisterServiceWorkers = async (): Promise<void> => {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
};

const wipeSiteData = async (deadline: number): Promise<void> => {
  await unregisterServiceWorkers();
  await deleteCacheStorage();
  await untilDeadline(deadline, removeOpfsEntries);
  await deleteIndexedDbs();
  safeSessionStorageClear();
  // Last, so a wipe cut short still finds the pending logout on the next boot.
  safeLocalStorageClear();
};

/**
 * Deletes everything the site stored on this device. Tabs booting together
 * queue on one lock; the first wipes and the others find nothing pending.
 */
export const finishPendingLogout = async (): Promise<void> => {
  const deadline = Date.now() + WIPE_DEADLINE_MS;
  await navigator.locks.request("linky.logout", async () => {
    if (isLogoutPending()) await wipeSiteData(deadline);
  });
};
