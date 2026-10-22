import { localStorageKv } from "./storage";

const WIPE_PENDING_KEY = "linky.onchainOperator.wipePending";

/** Reloads the app at its start, e.g. once another account's secrets are stored. */
export const reloadApp = (): void => {
  window.location.replace("/");
};

const WIPE_DEADLINE_MS = 10_000;
const RETRY_DELAY_MS = 250;

const removeOpfsEntries = async (): Promise<void> => {
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;
  // @ts-expect-error OPFS FileSystemDirectoryHandle.keys() is not in every TS lib yet
  for await (const name of root.keys()) {
    await root.removeEntry(name, { recursive: true });
  }
};

const deleteIndexedDbs = async (): Promise<void> => {
  const databases = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    databases.flatMap(({ name }) =>
      name
        ? [
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            }),
          ]
        : [],
    ),
  );
};

/**
 * Resets this device: everything the app stored here is deleted on the next
 * start, before Evolu opens its database, and the app reloads to the restore
 * screen. The account itself stays on the relays.
 */
export const resetDevice = (): void => {
  localStorageKv.setItem(WIPE_PENDING_KEY, "1");
  reloadApp();
};

/** Finishes a reset the previous page started; call it before anything opens storage. */
export const finishPendingWipe = async (): Promise<void> => {
  if (localStorageKv.getItem(WIPE_PENDING_KEY) !== "1") return;
  const deadline = Date.now() + WIPE_DEADLINE_MS;
  // The previous page's database worker can hold its files open a moment longer.
  for (;;) {
    try {
      await removeOpfsEntries();
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        console.warn("[onchain-operator] local database not removed", error);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  await deleteIndexedDbs();
  // Last, so a wipe cut short finds the pending flag on the next start.
  try {
    localStorage.clear();
  } catch {
    // Storage disabled: nothing was kept.
  }
};
