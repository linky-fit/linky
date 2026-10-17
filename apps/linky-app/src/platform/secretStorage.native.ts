import { reportAppLog } from "../devtools/inspector/appLog";
import { asNonEmptyString } from "../utils/validation";
import { SecretsWriteFailed, writeSecureSecretSet } from "./secureStoreSecrets";
import { secureStore } from "./secureStore.native";

// The secure store is the only copy: a secret it refuses is never written
// anywhere less safe.

/** Null when the secure store holds no value or fails to answer. */
export const readStoredSecret = async (key: string): Promise<string | null> =>
  asNonEmptyString(await secureStore.getItemAsync(key).catch(() => null));

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
  await secureStore.deleteItemAsync(key).catch(() => undefined);
};

/** Writes the secrets as one set; rejects with SecretsWriteFailed, restoring the old values, when the secure store refuses any. */
export const writeSecretSet = async (
  secrets: Readonly<Record<string, string>>,
): Promise<void> => {
  try {
    await writeSecureSecretSet(secureStore, secrets);
  } catch (error) {
    if (error instanceof SecretsWriteFailed) {
      reportAppLog({
        tag: "secrets.secureWriteRefused",
        summary: `Secure storage refused ${error.keys.length} of ${Object.keys(secrets).length} secrets; restored their previous values and kept no other copy`,
        payload: { keys: Object.keys(secrets), refused: error.keys },
      });
    }
    throw error;
  }
};

/** Rejects with SecretsWriteFailed when the secure store refuses the write. */
export const writeStoredSecret = (key: string, value: string): Promise<void> =>
  writeSecretSet({ [key]: value });
