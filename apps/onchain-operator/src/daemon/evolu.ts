import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
  type CreateSqliteDriver,
  type SqliteRow,
  type SqliteValue,
} from "@evolu/common";
import { linkyScopes, type LinkyStore } from "@linky-fit/linksync";
import {
  createLinkyEvolu,
  makeEvoluRelaySettings,
  openLinkyStore,
  type KeyValueStorage,
  type LinkyEvoluEvent,
} from "@linky-fit/linksync/evolu";
import { createInProcessOwnerSyncDbWorker } from "@linky-fit/linksync/evolu/worker";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../appConfig";
import type { Account } from "../storage/account";

const toSqliteRow = (row: Record<string, unknown>): SqliteRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]): [string, SqliteValue] => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        value instanceof Uint8Array
      ) {
        return [key, value];
      }
      if (typeof value === "bigint") return [key, Number(value)];
      throw new Error(`Unexpected SQLite value in column "${key}"`);
    }),
  );

const makeNodeSqliteDriver = (
  dataDir: string,
  inMemory: boolean,
  openedDatabases: DatabaseSync[],
): CreateSqliteDriver => {
  return (name, options) => {
    const useMemory = inMemory || options?.memory === true;
    let filePath = ":memory:";
    if (!useMemory) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      filePath = path.join(dataDir, `${name}.sqlite`);
    }
    const database = new DatabaseSync(filePath);
    if (!useMemory) {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    }
    openedDatabases.push(database);
    let closed = false;
    const closeDb = () => {
      if (closed) return;
      closed = true;
      database.close();
    };
    return Promise.resolve({
      exec: ({ sql, parameters }, isMutation) => {
        const statement = database.prepare(sql);
        if (isMutation) {
          return {
            rows: [],
            changes: Number(statement.run(...parameters).changes),
          };
        }
        return {
          rows: statement.all(...parameters).map(toSqliteRow),
          changes: 0,
        };
      },
      export: () => new Uint8Array(),
      [Symbol.dispose]: closeDb,
    });
  };
};

export interface DaemonStoreHandle {
  readonly store: LinkyStore;
  readonly evoluRelays: readonly string[];
  readonly close: () => void;
}

/**
 * Opens the operator account's sharded Evolu store in-process over `node:sqlite`
 * (works identically under Bun and Node) and syncs with the configured Evolu relays.
 */
export const openDaemonStore = async ({
  account,
  config,
  dataDir,
  kv,
  inMemory = false,
  onEvent,
}: {
  readonly account: Account;
  readonly config: AppConfig;
  readonly dataDir: string;
  readonly kv: KeyValueStorage;
  readonly inMemory?: boolean | undefined;
  readonly onEvent?: ((event: LinkyEvoluEvent) => void) | undefined;
}): Promise<DaemonStoreHandle> => {
  const relays = makeEvoluRelaySettings(kv, {
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    hasStoredAccount: false,
  });
  const evoluRelays = relays.activeUrls();
  const transports = evoluRelays.map((url) => ({
    type: "WebSocket" as const,
    url,
  }));
  const openedDatabases: DatabaseSync[] = [];
  const openedSockets: ReturnType<typeof createWebSocket>[] = [];
  const createSqliteDriver = makeNodeSqliteDriver(
    dataDir,
    inMemory,
    openedDatabases,
  );
  const trackedCreateWebSocket: typeof createWebSocket = (url, options) => {
    const socket = createWebSocket(url, options);
    openedSockets.push(socket);
    return socket;
  };
  const { evolu, ownerSync } = createLinkyEvolu({
    evoluDeps: {
      console: createConsole(),
      randomBytes: createRandomBytes(),
      reloadApp: () => {},
      time: createTime(),
    },
    createWorker: () =>
      createInProcessOwnerSyncDbWorker({
        console: createConsole(),
        createSqliteDriver,
        createWebSocket: trackedCreateWebSocket,
        random: createRandom(),
        randomBytes: createRandomBytes(),
        time: createTime(),
      }),
    mnemonic: account.appMnemonic,
    transports,
    inMemory,
    enableLogging: false,
    ...(onEvent ? { onEvent } : {}),
  });
  const store = await openLinkyStore(evolu, ownerSync, {
    kv,
    scopes: linkyScopes,
    hasEvoluRelay: transports.length > 0,
    ...(onEvent ? { onEvent } : {}),
  });
  return {
    store,
    evoluRelays,
    close: () => {
      // Evolu 7's `evolu[Symbol.dispose]()` throws "not yet implemented";
      // tear down the underlying relay sockets and SQLite handles directly.
      for (const socket of openedSockets) {
        try {
          socket[Symbol.dispose]();
        } catch {
          // Ignore already-closed sockets during shutdown.
        }
      }
      for (const db of openedDatabases) {
        try {
          db.close();
        } catch {
          // Already closed.
        }
      }
    },
  };
};
