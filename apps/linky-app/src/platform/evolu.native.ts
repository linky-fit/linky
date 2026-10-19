import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
  type CreateSqliteDriverDep,
} from "@evolu/common";
import { evoluReactNativeDeps } from "@evolu/react-native/expo-sqlite";
import { createInProcessOwnerSyncDbWorker } from "@linky-fit/linksync/evolu/worker";
import { safeLocalStorageGet } from "../utils/storage";
import { isDevBuild } from "./buildEnv";
import type { EvoluPlatform } from "./ports";

const hasSqliteDriver = (deps: object): deps is CreateSqliteDriverDep =>
  "createSqliteDriver" in deps;

// @evolu/react-native exports no driver factory; createSharedEvoluDeps spreads it into these deps.
const sqliteDriverOf = (deps: object): CreateSqliteDriverDep => {
  if (!hasSqliteDriver(deps))
    throw new Error("@evolu/react-native no longer carries its SQLite driver");
  return deps;
};

/**
 * The database worker runs in this thread, on expo-sqlite, so the owner-sync
 * tap still sees every relay round. Logs SQL on request, as on the web.
 */
export const makeNativeEvoluPlatform = (): Promise<EvoluPlatform> => {
  const { createSqliteDriver } = sqliteDriverOf(evoluReactNativeDeps);
  return Promise.resolve({
    evoluDeps: evoluReactNativeDeps,
    createWorker: () =>
      createInProcessOwnerSyncDbWorker({
        console: createConsole(),
        createSqliteDriver,
        createWebSocket,
        random: createRandom(),
        randomBytes: createRandomBytes(),
        time: createTime(),
      }),
    inMemory: false,
    enableLogging:
      isDevBuild && safeLocalStorageGet("linky_debug_evolu_sql") === "1",
  });
};
