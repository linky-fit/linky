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
    const wroteToAndroidBridge = await writeAndroidStoredSecret(
      key,
      normalized,
    );

    if (supportsIosNativeSecretStorage()) {
      try {
        await LinkySecretStorage.set({ key, value: normalized });
      } catch {
        // ignore
      }
    }

    const secretStorage = getNativeSecretStorage();
    if (secretStorage) {
      try {
        await secretStorage.set({ key, value: normalized });
      } catch {
        // ignore
      }
    }

    if (wroteToAndroidBridge) {
      safeLocalStorageSet(key, normalized);
      return;
    }
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
