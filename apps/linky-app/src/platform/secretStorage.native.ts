import { safeLocalStorageGet, safeLocalStorageRemove } from "../utils/storage";
import { asNonEmptyString } from "../utils/validation";
import { secureStore } from "./secureStore.native";

// The secure store is the only copy. A localStorage value exists only after
// identitySecrets' rollback, when the secure store refused a write.

export const readStoredSecret = async (key: string): Promise<string | null> => {
  try {
    const value = asNonEmptyString(await secureStore.getItemAsync(key));
    if (value !== null) return value;
  } catch {
    // Falls back to a rolled-back copy below.
  }
  return asNonEmptyString(safeLocalStorageGet(key));
};

/** Rejects when the secure store fails to answer. */
export const readNativeSecret = async (
  key: string,
): Promise<string | null | undefined> =>
  asNonEmptyString(await secureStore.getItemAsync(key));

export const writeNativeSecret = (key: string, value: string): Promise<void> =>
  secureStore.setItemAsync(key, value);

/** Removes the key from the secure store only; rejects when it fails. */
export const removeNativeSecret = (key: string): Promise<void> =>
  secureStore.deleteItemAsync(key);

export const removeStoredSecret = async (key: string): Promise<void> => {
  safeLocalStorageRemove(key);
  await secureStore.deleteItemAsync(key).catch(() => undefined);
};

/** Rejects when the secure store refuses the write. */
export const writeStoredSecret = async (
  key: string,
  value: string,
): Promise<void> => {
  const normalized = asNonEmptyString(value);
  if (normalized === null) return removeStoredSecret(key);
  await secureStore.setItemAsync(key, normalized);
  safeLocalStorageRemove(key);
};
