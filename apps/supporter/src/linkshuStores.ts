import {
  applyOperationPatch,
  applyProofPatch,
  deriveStoreId,
  KeyValueStore,
  LeaseId,
  OperationId,
  operationKeyOf,
  OperationStore,
  ProofId,
  ProofStore,
  StoredOperation,
  StoredProof,
  UnixSeconds,
} from "@linky-fit/linkshu";
import type {
  KeyValueStoreService,
  OperationStoreService,
  ProofStoreService,
} from "@linky-fit/linkshu";
import type { Database } from "bun:sqlite";
import { Clock, Effect, Layer, Option, Schema } from "effect";

/**
 * linkshu's three ports over the service's SQLite file. Leases are claimed
 * inside immediate transactions, so the CLI and the service never both win.
 */
export const makeSqliteKeyValueStore = (db: Database): KeyValueStoreService => {
  const liveLease = (key: string, now: number) =>
    db
      .query<
        { lease: string },
        [string, number]
      >("SELECT lease FROM linkshu_leases WHERE key = ? AND expires_at > ?")
      .get(key, now);
  const putLease = (key: string, lease: LeaseId, expiresAt: number) =>
    db
      .query(
        "INSERT INTO linkshu_leases (key, lease, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET lease = excluded.lease, expires_at = excluded.expires_at",
      )
      .run(key, lease, expiresAt);

  return {
    get: (key) =>
      Effect.sync(
        () =>
          db
            .query<
              { value: string },
              [string]
            >("SELECT value FROM linkshu_kv WHERE key = ?")
            .get(key)?.value ?? null,
      ),
    set: (key, value) =>
      Effect.sync(() => {
        db.query(
          "INSERT INTO linkshu_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        ).run(key, value);
      }),
    remove: (key) =>
      Effect.sync(() => {
        db.query("DELETE FROM linkshu_kv WHERE key = ?").run(key);
      }),
    listKeys: (prefix) =>
      Effect.sync(() =>
        db
          .query<{ key: string }, [number, string]>(
            "SELECT key FROM linkshu_kv WHERE substr(key, 1, ?) = ?",
          )
          .all(prefix.length, prefix)
          .map((row) => row.key),
      ),
    tryAcquireLease: (key, ttlMs) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() =>
          db
            .transaction(() => {
              if (liveLease(key, now) !== null) return null;
              const lease = LeaseId.make(crypto.randomUUID());
              putLease(key, lease, now + ttlMs);
              return lease;
            })
            .immediate(),
        ),
      ),
    renewLease: (key, lease, ttlMs) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          db.query(
            "UPDATE linkshu_leases SET expires_at = ? WHERE key = ? AND lease = ?",
          ).run(now + ttlMs, key, lease);
        }),
      ),
    releaseLease: (key, lease) =>
      Effect.sync(() => {
        db.query("DELETE FROM linkshu_leases WHERE key = ? AND lease = ?").run(
          key,
          lease,
        );
      }),
  };
};

/** One table of JSON rows in the port's own schema, in insertion order. */
const makeRowTable = <A extends { readonly id: string }, I>(
  db: Database,
  table: "linkshu_proofs" | "linkshu_operations",
  schema: Schema.Schema<A, I>,
) => {
  const json = Schema.parseJson(schema);
  const encode = Schema.encodeSync(json);
  const decode = Schema.decodeUnknownOption(json);
  const loadAll = (): ReadonlyArray<A> =>
    db
      .query<{ row: string }, []>(`SELECT row FROM ${table} ORDER BY rowid`)
      .all()
      .flatMap((stored) => Option.toArray(decode(stored.row)));
  const find = (id: string): A | null => {
    const stored = db
      .query<{ row: string }, [string]>(`SELECT row FROM ${table} WHERE id = ?`)
      .get(id);
    return stored === null ? null : Option.getOrNull(decode(stored.row));
  };
  const put = (row: A): void => {
    db.query(
      `INSERT INTO ${table} (id, row) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET row = excluded.row`,
    ).run(row.id, encode(row));
  };
  const update = (id: string, change: (row: A) => A): void =>
    db.transaction(() => {
      const row = find(id);
      if (row !== null) put(change(row));
    })();
  return { loadAll, find, put, update };
};

export const makeSqliteProofStore = (db: Database): ProofStoreService => {
  const rows = makeRowTable(db, "linkshu_proofs", StoredProof);
  return {
    insert: (proofs) =>
      Effect.flatMap(Clock.currentTimeMillis, (millis) =>
        Effect.sync(() =>
          db.transaction(() =>
            proofs.map((proof) => {
              const id = ProofId.make(deriveStoreId(proof.secret));
              const stored = new StoredProof({
                ...proof,
                id,
                createdAt:
                  rows.find(id)?.createdAt ??
                  UnixSeconds.make(Math.floor(millis / 1000)),
              });
              rows.put(stored);
              return stored;
            }),
          )(),
        ),
      ),
    update: (id, patch) =>
      Effect.sync(() => rows.update(id, (row) => applyProofPatch(row, patch))),
    loadAll: Effect.sync(rows.loadAll),
  };
};

export const makeSqliteOperationStore = (
  db: Database,
): OperationStoreService => {
  const rows = makeRowTable(db, "linkshu_operations", StoredOperation);
  return {
    insert: (operation) =>
      Effect.sync(() => {
        const id = OperationId.make(deriveStoreId(operationKeyOf(operation)));
        const stored = new StoredOperation({ ...operation, id });
        rows.put(stored);
        return stored;
      }),
    update: (id, patch) =>
      Effect.sync(() =>
        rows.update(id, (row) => applyOperationPatch(row, patch)),
      ),
    loadAll: Effect.sync(rows.loadAll),
  };
};

export const sqliteLinkshuStores = (db: Database) => ({
  keyValueStore: Layer.sync(KeyValueStore, () => makeSqliteKeyValueStore(db)),
  proofStore: Layer.sync(ProofStore, () => makeSqliteProofStore(db)),
  operationStore: Layer.sync(OperationStore, () =>
    makeSqliteOperationStore(db),
  ),
});
