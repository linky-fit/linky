import { Capacitor, registerPlugin } from "@capacitor/core";
import type {
  LinkyNativeBridge,
  NativeSecretStorageBridge,
} from "../types/browser";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../utils/storage";
import {
  readAndroidStoredSecret,
  removeAndroidStoredSecret,
  writeAndroidStoredSecret,
} from "./nativeBridge";
import { reportAppLog } from "../devtools/inspector/appLog";
import { getPlatformTarget, isNativePlatform } from "./runtime";
import { isRecord } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";

interface IosSecretStoragePlugin {
  get(options: { key: string }): Promise<{ value?: string | null }>;
  remove(options: { key: string }): Promise<void>;
  set(options: { key: string; value: string }): Promise<void>;
}

const LinkySecretStorage =
  registerPlugin<IosSecretStoragePlugin>("LinkySecretStorage");

const isNativeSecretStorageBridge = (
  value: unknown,
): value is NativeSecretStorageBridge => {
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "get") === "function" &&
    typeof Reflect.get(value, "remove") === "function" &&
    typeof Reflect.get(value, "set") === "function"
  );
};

const isLinkyNativeBridge = (value: unknown): value is LinkyNativeBridge => {
  if (!isRecord(value)) return false;
  const secretStorage = Reflect.get(value, "secretStorage");
  return (
    secretStorage === undefined || isNativeSecretStorageBridge(secretStorage)
  );
};

const supportsIosNativeSecretStorage = (): boolean => {
  return (
    getPlatformTarget() === "ios" &&
    Capacitor.isPluginAvailable("LinkySecretStorage")
  );
};

const getNativeSecretStorage = () => {
  const bridge = Reflect.get(globalThis, "LinkyNative");
  if (!isLinkyNativeBridge(bridge)) return null;

  const secretStorage = bridge.secretStorage;
  return isNativeSecretStorageBridge(secretStorage) ? secretStorage : null;
};

const readNativeSecretValue = async (key: string): Promise<string | null> => {
  if (supportsIosNativeSecretStorage()) {
    const result = await LinkySecretStorage.get({ key });
    return asNonEmptyString(result.value);
  }

  const secretStorage = getNativeSecretStorage();
  if (!secretStorage) return null;

  const result = await secretStorage.get({ key });
  if (typeof result === "string") {
    return asNonEmptyString(result);
  }
  if (!isRecord(result)) {
    return null;
  }

  return asNonEmptyString(Reflect.get(result, "value"));
};

export const readStoredSecret = async (key: string): Promise<string | null> => {
  if (isNativePlatform()) {
    const androidValue = await readAndroidStoredSecret(key);
    if (androidValue !== undefined) {
      return androidValue;
    }

    try {
      const nativeValue = await readNativeSecretValue(key);
      if (nativeValue !== null) {
        return nativeValue;
      }
    } catch {
      // ignore
    }
  }

  return asNonEmptyString(safeLocalStorageGet(key));
};

/** Resolves undefined when there is no native secret store; rejects when it fails to answer. */
export const readNativeSecret = async (
  key: string,
): Promise<string | null | undefined> => {
  const androidValue = await readAndroidStoredSecret(key);
  if (androidValue !== undefined) return androidValue;
  if (!supportsIosNativeSecretStorage() && !getNativeSecretStorage()) {
    return undefined;
  }
  return readNativeSecretValue(key);
};

export const writeNativeSecret = async (
  key: string,
  value: string,
): Promise<void> => {
  await writeAndroidStoredSecret(key, value);

  if (supportsIosNativeSecretStorage()) {
    try {
      await LinkySecretStorage.set({ key, value });
    } catch {
      // ignore
    }
  }

  const secretStorage = getNativeSecretStorage();
  if (secretStorage) {
    try {
      await secretStorage.set({ key, value });
    } catch {
      // ignore
    }
  }
};

/** Removes the key from the native secure storage only; rejects when a native store fails. */
export const removeNativeSecret = async (key: string): Promise<void> => {
  await Promise.all([
    removeAndroidStoredSecret(key),
    supportsIosNativeSecretStorage()
      ? LinkySecretStorage.remove({ key })
      : undefined,
    getNativeSecretStorage()?.remove({ key }),
  ]);
};

export const writeStoredSecret = async (
  key: string,
  value: string,
): Promise<void> => {
  const normalized = asNonEmptyString(value);
  if (!normalized) {
    await removeStoredSecret(key);
    return;
  }

  if (isNativePlatform()) {
    await writeNativeSecret(key, normalized);
  }

  safeLocalStorageSet(key, normalized);
};

export const removeStoredSecret = async (key: string): Promise<void> => {
  if (isNativePlatform()) {
    const removedFromAndroidBridge = await removeAndroidStoredSecret(key);

    if (supportsIosNativeSecretStorage()) {
      try {
        await LinkySecretStorage.remove({ key });
      } catch {
        // ignore
      }
    }

    const secretStorage = getNativeSecretStorage();
    if (secretStorage) {
      try {
        await secretStorage.remove({ key });
      } catch {
        // ignore
      }
    }

    if (removedFromAndroidBridge) {
      safeLocalStorageRemove(key);
      return;
    }
  }

  safeLocalStorageRemove(key);
};

const nativeHolds = async (key: string, value: string): Promise<boolean> => {
  try {
    return (await readNativeSecret(key)) === asNonEmptyString(value);
  } catch {
    return false;
  }
};

const writeLocalSecret = (key: string, value: string): void => {
  const normalized = asNonEmptyString(value);
  if (normalized) safeLocalStorageSet(key, normalized);
  else safeLocalStorageRemove(key);
};

/**
 * Writes the secrets as one set. Boot reads the native store first, so when
 * it misses any of them the set is removed from it and boot reads the
 * complete localStorage copy instead of a mix of old and new secrets.
 */
export const writeSecretSet = async (
  secrets: Readonly<Record<string, string>>,
): Promise<void> => {
  const entries = Object.entries(secrets);
  const writes = entries.map(([key, value]) => writeStoredSecret(key, value));
  if (!isNativePlatform()) {
    await Promise.all(writes);
    return;
  }
  await Promise.allSettled(writes);
  const held = await Promise.all(
    entries.map(([key, value]) => nativeHolds(key, value)),
  );
  const missed = entries.filter((_, index) => !held[index]);
  if (missed.length === 0) return;

  // A native write that throws skips its localStorage write.
  for (const [key, value] of entries) writeLocalSecret(key, value);
  const removals = await Promise.allSettled(
    entries.map(([key]) => removeNativeSecret(key)),
  );
  reportAppLog({
    tag: "secrets.nativeWriteRolledBack",
    summary: `Native secure storage missed ${missed.length} of ${entries.length} secrets; removed the set from it so boot reads localStorage`,
    payload: {
      keys: entries.map(([key]) => key),
      missed: missed.map(([key]) => key),
      notRemoved: entries
        .filter((_, index) => removals[index].status === "rejected")
        .map(([key]) => key),
    },
  });
};
