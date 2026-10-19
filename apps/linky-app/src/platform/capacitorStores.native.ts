import { requireOptionalNativeModule } from "expo";
import {
  migrateCapacitorApp,
  withUnmigratedSecrets,
  type CapacitorStores,
} from "./capacitorMigration";
import type { PlatformPorts } from "./ports";
import { secureStore } from "./secureStore.native";

// apps/expo/modules/linky-legacy-secrets, built for Android only.
const legacyStores =
  requireOptionalNativeModule<CapacitorStores>("LinkyLegacySecrets");

// Boot waits for the migration, so a WebView that never answers must not hold it.
const WEB_STORAGE_READ_TIMEOUT_MS = 10_000;

const withTimeout = <A>(read: Promise<A>): Promise<A> =>
  Promise.race([
    read,
    new Promise<never>((_, reject) =>
      globalThis.setTimeout(
        () => reject(new Error("timed out")),
        WEB_STORAGE_READ_TIMEOUT_MS,
      ),
    ),
  ]);

const stores: CapacitorStores | null =
  legacyStores === null
    ? null
    : {
        hasLegacySecrets: () => legacyStores.hasLegacySecrets(),
        readLegacySecrets: () => legacyStores.readLegacySecrets(),
        readLegacyWebStorage: () =>
          withTimeout(legacyStores.readLegacyWebStorage()),
        clearLegacyStores: () => legacyStores.clearLegacyStores(),
      };

/**
 * Moves an Android Capacitor install into the app, once; the returned ports
 * read the secrets that didn't arrive as unavailable. Runs after a pending
 * logout's wipe and before the session loads.
 */
export const adoptCapacitorApp = async (
  ports: PlatformPorts,
): Promise<PlatformPorts> => {
  const unmigrated = await migrateCapacitorApp({
    stores,
    store: secureStore,
    kv: ports.kv,
  });
  return unmigrated.size === 0
    ? ports
    : { ...ports, secrets: withUnmigratedSecrets(ports.secrets, unmigrated) };
};

/** Deletes what an Android Capacitor install left behind; resolves at once elsewhere. */
export const clearCapacitorStores = async (): Promise<void> => {
  await stores?.clearLegacyStores();
};
