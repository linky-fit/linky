import {
  createBroadcastChannel,
  createConsole,
  createConsoleStoreOutput,
  createMessageChannel,
  createMessagePort,
  createRandomBytes,
  createRun,
  createSharedWorker,
  createWebSocket,
  createWorker,
  ok,
  waitForAbort,
  type Name,
} from "@evolu/common";
import {
  createEvoluDeps,
  initSharedWorker,
  startDbWorker,
  type EvoluDeps,
  type SharedWorkerInput,
  type SharedWorkerOutput,
} from "@evolu/common/local-first";
import { installPolyfills } from "@evolu/common/polyfills";
import { createNodeJsSqliteDriver } from "@evolu/nodejs";
import { linkyScopes, type LinkyStore } from "@linky-fit/linksync";
import {
  awaitDatabaseReady,
  makeEvoluRelaySettings,
  openLinkyEvolu,
  openLinkyStore,
  toEvoluTransports,
  type KeyValueStorage,
  type LinkyEvoluEvent,
} from "@linky-fit/linksync/evolu";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppConfig } from "../appConfig";
import type { Account } from "../storage/account";

const deleteDatabaseFiles = (name: Name) => () => {
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    fs.rmSync(path.resolve(`${name}.db${suffix}`), { force: true });
  return ok();
};

const createWorkerRun = () => {
  const consoleStoreOutput = createConsoleStoreOutput();
  return createRun({
    console: createConsole({ output: consoleStoreOutput }),
    consoleStoreOutputEntry: consoleStoreOutput.entry,
    createBroadcastChannel,
    createMessageChannel,
    createMessagePort,
    createWebSocket,
    createSqliteDriver: createNodeJsSqliteDriver,
    deleteDatabaseFiles,
    lockManager: navigator.locks,
    randomBytes: createRandomBytes(),
  });
};

/**
 * Evolu's workers in this process, as `@evolu/react-native` runs them: Node.js
 * has no SharedWorker, and one daemon is the only client of its database.
 */
const createNodeEvoluDeps = (): EvoluDeps => {
  installPolyfills();
  return createEvoluDeps({
    createDbWorker: () =>
      createWorker((self) => void createWorkerRun()(startDbWorker(self))),
    createStoredWorker: () =>
      createSharedWorker<SharedWorkerInput, SharedWorkerOutput>((self) => {
        void createWorkerRun()(async (run) => {
          const worker = await run.ok(initSharedWorker(self));
          try {
            return await run(waitForAbort);
          } finally {
            await worker.disposeAsync();
          }
        });
      }),
    createBroadcastChannel,
    createMessageChannel,
    getDevicePersistence: () => Promise.resolve("Persisted"),
    lockManager: navigator.locks,
    reloadApp: () => {},
  });
};

export interface DaemonStoreHandle {
  readonly store: LinkyStore;
  readonly evoluRelays: readonly string[];
  readonly close: () => Promise<void>;
}

/**
 * Opens the operator account's sharded Evolu database in the working
 * directory, or in memory, and syncs it with the configured Evolu relays.
 */
export const openDaemonStore = async ({
  account,
  config,
  kv,
  memoryOnly,
  onEvent,
}: {
  readonly account: Account;
  readonly config: AppConfig;
  readonly kv: KeyValueStorage;
  readonly memoryOnly: boolean;
  readonly onEvent: (event: LinkyEvoluEvent) => void;
}): Promise<DaemonStoreHandle> => {
  const evoluRelays = makeEvoluRelaySettings(kv, {
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    hasStoredAccount: false,
    onEvent,
  }).activeUrls();
  const deps = createNodeEvoluDeps();
  const run = createRun(deps);
  const close = async () => {
    await run[Symbol.asyncDispose]();
    deps[Symbol.dispose]();
  };
  try {
    const evolu = await openLinkyEvolu(run, {
      mnemonic: account.appMnemonic,
      relayUrls: evoluRelays,
      memoryOnly,
    });
    await awaitDatabaseReady(evolu, deps.evoluError);
    const store = await openLinkyStore(evolu, {
      syncState: deps.syncState,
      kv,
      scopes: linkyScopes,
      hasEvoluRelay: toEvoluTransports(evoluRelays).length > 0,
      memoryOnly,
      onEvent,
    });
    return { store, evoluRelays, close };
  } catch (error) {
    await close();
    throw error;
  }
};
