import { localStorageKv } from "./storage";

const WIPE_PENDING_KEY = "linky.fazole.wipePending";
// The pending wipe's value when another device removed this one.
const REMOVED = "removed";
/** Names the device that removed this one, across the wipe, so the welcome screen can say who. */
const REMOVED_NOTICE_KEY = "linky.fazole.removedFromDevices";

/**
 * Set on the first start after another device removed this one: the device
 * that did, or `null` for `removedBy` when it was not known.
 */
export const removedFromDevices = (): {
  readonly removedBy: string | null;
} | null => {
  const removedBy = localStorageKv.getItem(REMOVED_NOTICE_KEY);
  return removedBy === null ? null : { removedBy: removedBy || null };
};

/** The notice shows on the first start after the removal only. */
export const forgetRemovedFromDevices = (): void =>
  localStorageKv.removeItem(REMOVED_NOTICE_KEY);

export const reloadApp = (): void => {
  window.location.replace("/");
};

const WIPE_DEADLINE_MS = 10_000;
const RETRY_DELAY_MS = 250;

const removeOpfsEntries = async (): Promise<void> => {
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;
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
 * start, before Evolu opens its database, and the app reloads to the welcome
 * screen. The account itself stays on the relays.
 */
export const resetDevice = (
  removal?: { readonly removedBy: string | null } | undefined,
): void => {
  if (removal !== undefined)
    localStorageKv.setItem(REMOVED_NOTICE_KEY, removal.removedBy ?? "");
  localStorageKv.setItem(
    WIPE_PENDING_KEY,
    removal === undefined ? "1" : REMOVED,
  );
  reloadApp();
};

/** Finishes a reset the previous page started; call it before anything opens storage. */
export const finishPendingWipe = async (): Promise<void> => {
  const pending = localStorageKv.getItem(WIPE_PENDING_KEY);
  if (pending !== "1" && pending !== REMOVED) return;
  const removedBy =
    pending === REMOVED
      ? (localStorageKv.getItem(REMOVED_NOTICE_KEY) ?? "")
      : null;
  const deadline = Date.now() + WIPE_DEADLINE_MS;
  // The previous page's database worker can hold its files open a moment longer.
  for (;;) {
    try {
      await removeOpfsEntries();
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          "Close other Fazole tabs and reload to finish resetting.",
          { cause: error },
        );
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
  if (removedBy !== null) localStorageKv.setItem(REMOVED_NOTICE_KEY, removedBy);
};
