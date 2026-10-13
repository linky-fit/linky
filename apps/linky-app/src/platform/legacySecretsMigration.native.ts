import { requireOptionalNativeModule } from "expo";
import {
  migrateLegacySecrets,
  withUnmigratedSecrets,
  type LegacySecretStore,
} from "./legacySecrets";
import type { PlatformPorts } from "./ports";
import { secureStore } from "./secureStore.native";

// apps/expo/modules/linky-legacy-secrets, built for Android only.
const legacy =
  requireOptionalNativeModule<LegacySecretStore>("LinkyLegacySecrets");

/**
 * Moves an Android Capacitor install's secrets into the secure store, once;
 * the returned ports read the keys that didn't arrive as unavailable. Runs
 * after a pending logout's wipe and before the session loads.
 */
export const adoptLegacySecrets = async (
  ports: PlatformPorts,
): Promise<PlatformPorts> => {
  const unmigrated = await migrateLegacySecrets({
    legacy,
    store: secureStore,
    kv: ports.kv,
  });
  return unmigrated.size === 0
    ? ports
    : { ...ports, secrets: withUnmigratedSecrets(ports.secrets, unmigrated) };
};
