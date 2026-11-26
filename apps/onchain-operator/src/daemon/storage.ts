import {
  KeyValueStore,
  LeaseId,
  type KeyValueStoreService,
} from "@linky-fit/linkshu";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Clock, Effect, Layer } from "effect";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

const LINKSHU_VALUE_PREFIX = "linky.linkshu.value.";

export interface DaemonStorage {
  readonly kv: KeyValueStorage;
  readonly linkshuKeyValueStore: Layer.Layer<KeyValueStore>;
  readonly close: () => void;
}

const escapeLike = (text: string): string =>
  text.replace(/[\\_%]/gu, (match) => `\\${match}`);

const stringField = (
  row: Record<string, unknown> | undefined,
  field: string,
): string | null => {
  const value = row?.[field];
  return typeof value === "string" ? value : null;
};

/**
 * Single SQLite-backed device-local store for the headless daemon: holds
 * linksync metadata, linkstr outbox/cursor, early ecash, and linkshu
 * counters/leases atomically in one file.
 */
export const openDaemonStorage = (dbPath: string): DaemonStorage => {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leases (
      key TEXT PRIMARY KEY,
      lease TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
  const setStmt = db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const removeStmt = db.prepare("DELETE FROM kv WHERE key = ?");
  const listStmt = db.prepare(
    "SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key",
  );
  const getLeaseStmt = db.prepare(
    "SELECT lease, expires_at FROM leases WHERE key = ?",
  );
  const putLeaseStmt = db.prepare(
    "INSERT INTO leases (key, lease, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET lease = excluded.lease, expires_at = excluded.expires_at",
  );
  const renewLeaseStmt = db.prepare(
    "UPDATE leases SET expires_at = ? WHERE key = ? AND lease = ?",
  );
  const releaseLeaseStmt = db.prepare(
    "DELETE FROM leases WHERE key = ? AND lease = ?",
  );

  const kv: KeyValueStorage = {
    getItem: (key) => stringField(getStmt.get(key), "value"),
    setItem: (key, value) => {
      setStmt.run(key, value);
    },
    removeItem: (key) => {
      removeStmt.run(key);
    },
  };

  const linkshuService: KeyValueStoreService = {
    get: (key) => Effect.sync(() => kv.getItem(LINKSHU_VALUE_PREFIX + key)),
    set: (key, value) =>
      Effect.sync(() => {
        kv.setItem(LINKSHU_VALUE_PREFIX + key, value);
      }),
    remove: (key) =>
      Effect.sync(() => {
        kv.removeItem(LINKSHU_VALUE_PREFIX + key);
      }),
    listKeys: (prefix) =>
      Effect.sync(() => {
        const pattern = `${escapeLike(LINKSHU_VALUE_PREFIX + prefix)}%`;
        return listStmt.all(pattern).flatMap((row) => {
          const key = stringField(row, "key");
          return key !== null && key.startsWith(LINKSHU_VALUE_PREFIX)
            ? [key.slice(LINKSHU_VALUE_PREFIX.length)]
            : [];
        });
      }),
    tryAcquireLease: (key, ttlMs) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const held = getLeaseStmt.get(key);
        const expiresAt = held?.expires_at;
        if (typeof expiresAt === "number" && expiresAt > now) return null;
        const lease = LeaseId.make(crypto.randomUUID());
        putLeaseStmt.run(key, lease, now + ttlMs);
        return lease;
      }),
    renewLease: (key, lease, ttlMs) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        renewLeaseStmt.run(now + ttlMs, key, lease);
      }),
    releaseLease: (key, lease) =>
      Effect.sync(() => {
        releaseLeaseStmt.run(key, lease);
      }),
  };

  return {
    kv,
    linkshuKeyValueStore: Layer.succeed(KeyValueStore, linkshuService),
    close: () => {
      db.close();
    },
  };
};
