/** Calls `callback` whenever another tab changes the localStorage `key`; returns the unsubscribe. */
export const onStorageKeyChangedInAnotherTab = (
  key: string,
  callback: () => void,
): (() => void) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === key) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};
