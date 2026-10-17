import { localStorageKv } from "../utils/storage";
import { isOnline } from "./appEvents";
import { envEvoluServerUrls, isDevBuild } from "./buildEnv";
import { parseEvoluRelayUrls } from "./evoluRelayUrls";
import type { PlatformPorts } from "./ports";
import { reloadApp } from "./reload";
import { makeNativeSecretsPort } from "./secureStoreSecrets";
import { secureStore } from "./secureStore.native";

/** Ports for iOS and Android: secrets in the secure store only, kv on expo-sqlite's localStorage. */
export const makeNativePlatformPorts = (): PlatformPorts => ({
  kv: localStorageKv,
  secrets: makeNativeSecretsPort(secureStore),
  config: {
    evoluRelayDefaults: parseEvoluRelayUrls(envEvoluServerUrls),
    isE2e: false,
    isDev: isDevBuild,
    blockOnFirstHydration: true,
  },
  lifecycle: {
    reload: reloadApp,
    // The store ships updates; nothing reloads the running app from under it.
    deferUpdateWhile: () => {},
    isOnline,
  },
});
