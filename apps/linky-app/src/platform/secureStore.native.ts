import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { reportAppLog } from "../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../utils/unknown";

const readAccessGroup = (): string | undefined => {
  const group: unknown = Constants.expoConfig?.extra?.["keychainAccessGroup"];
  return typeof group === "string" && group !== "" ? group : undefined;
};

// The app's own keychain group (app.config.ts), so a notification extension can join it without moving items.
const accessGroup = readAccessGroup();

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  ...(accessGroup === undefined ? {} : { accessGroup }),
};

const reported = async <T>(
  operation: "read" | "write" | "delete",
  key: string,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    reportAppLog({
      tag: "secrets.secureStoreFailed",
      summary: `Secure storage failed to ${operation} ${key}`,
      payload: {
        operation,
        key,
        cause: getUnknownErrorMessage(error, "unknown"),
      },
    });
    throw error;
  }
};

/** expo-secure-store (iOS Keychain, Android Keystore) with Linky's options; every failure is reported. */
export const secureStore = {
  getItemAsync: (key: string): Promise<string | null> =>
    reported("read", key, () => SecureStore.getItemAsync(key, options)),
  setItemAsync: (key: string, value: string): Promise<void> =>
    reported("write", key, () => SecureStore.setItemAsync(key, value, options)),
  deleteItemAsync: (key: string): Promise<void> =>
    reported("delete", key, () => SecureStore.deleteItemAsync(key, options)),
};
