import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database, type SQLQueryBindings } from "bun:sqlite";

import type {
  ChallengeRecord,
  NativePushSubscriptionData,
  ProofAction,
  StoredNativeSubscription,
  StoredSubscription,
  WebPushSubscriptionData,
} from "./types";

interface SubscriptionAssociationParams {
  cleanupLegacySubscriptions: boolean;
  installationId: string | null;
  recipientPubkeys: string[];
  consumedChallengeNonces: string[];
  maxPubkeysPerSubscription: number;
  maxSubscriptionsPerPubkey: number;
  nowMs: number;
}

interface RegisterSubscriptionParams extends SubscriptionAssociationParams {
  subscription: WebPushSubscriptionData;
}

interface RegisterNativeSubscriptionParams extends SubscriptionAssociationParams {
  device: NativePushSubscriptionData;
}

interface UnregisterPubkeysParams {
  recipientPubkeys: string[];
  consumedChallengeNonces: string[];
  nowMs: number;
}

interface UnregisterSubscriptionPubkeysParams extends UnregisterPubkeysParams {
  endpoint: string;
}

interface UnregisterNativeSubscriptionPubkeysParams extends UnregisterPubkeysParams {
  token: string;
}

interface UnregisterSubscriptionPubkeysResult {
  removedPubkeys: number;
  removedSubscription: boolean;
}

interface SubscriptionTables {
  association: string;
  subscription: string;
  key: string;
  columns: readonly string[];
}

interface SubscriptionRow {
  pubkey: string;
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
}

interface NativeSubscriptionRow {
  pubkey: string;
  id: number;
  platform: "android";
  token: string;
}

interface IdRow {
  id: number;
}

interface CountRow {
  total: number;
}

const WEB_TABLES: SubscriptionTables = {
  association: "subscription_pubkeys",
  subscription: "subscriptions",
  key: "endpoint",
  columns: ["endpoint", "p256dh", "auth", "expiration_time"],
};

const NATIVE_TABLES: SubscriptionTables = {
  association: "native_subscription_pubkeys",
  subscription: "native_subscriptions",
  key: "token",
  columns: ["token", "platform"],
};

export class StorageLimitError extends Error {
  readonly status = 409;
  readonly code = "subscription_limit";
}

export class StorageConflictError extends Error {
  readonly status = 409;
  readonly code = "storage_conflict";
}

function readSafeInteger(value: number | bigint): number | null {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}

function hasSafeId(row: IdRow): boolean {
  return Number.isSafeInteger(row.id);
}

function createNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function groupByPubkey<Row extends IdRow & { pubkey: string }, Stored>(
  rows: Row[],
  toStored: (row: Row) => Stored,
): Map<string, Stored[]> {
  const out = new Map<string, Stored[]>();
  for (const row of rows.filter(hasSafeId)) {
    const stored = toStored(row);
    const existing = out.get(row.pubkey);
    if (existing) {
      existing.push(stored);
    } else {
      out.set(row.pubkey, [stored]);
    }
  }
  return out;
}

export class PushStorage {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });

    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL UNIQUE,
        installation_id TEXT,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        expiration_time INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subscription_pubkeys (
        subscription_id INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (subscription_id, pubkey),
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_subscription_pubkeys_pubkey
      ON subscription_pubkeys (pubkey);

      CREATE TABLE IF NOT EXISTS native_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        installation_id TEXT,
        platform TEXT NOT NULL CHECK (platform IN ('android')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS native_subscription_pubkeys (
        subscription_id INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (subscription_id, pubkey),
        FOREIGN KEY (subscription_id) REFERENCES native_subscriptions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_native_subscription_pubkeys_pubkey
      ON native_subscription_pubkeys (pubkey);

      CREATE TABLE IF NOT EXISTS challenges (
        nonce TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('subscribe', 'unsubscribe')),
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_challenges_pubkey_action
      ON challenges (pubkey, action);

      CREATE TABLE IF NOT EXISTS seen_events (
        event_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_seen_events_first_seen_at
      ON seen_events (first_seen_at);
    `);
    this.ensureSubscriptionsInstallationIdColumn();
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_installation_id
      ON subscriptions (installation_id)
      WHERE installation_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_native_subscriptions_installation_id
      ON native_subscriptions (installation_id)
      WHERE installation_id IS NOT NULL;
    `);
  }

  // Databases created before installation ids existed lack the column; CREATE
  // TABLE IF NOT EXISTS does not add it.
  private ensureSubscriptionsInstallationIdColumn(): void {
    const columns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(subscriptions)")
      .all();
    if (columns.some((column) => column.name === "installation_id")) {
      return;
    }
    this.db.exec("ALTER TABLE subscriptions ADD COLUMN installation_id TEXT;");
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(run: () => T): T {
    return this.db.transaction(run)();
  }

  createChallenge(
    pubkey: string,
    action: ProofAction,
    expiresAt: number,
    nowMs: number,
  ): string {
    this.pruneChallenges(nowMs);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nonce = createNonce();
      const result = this.db
        .query(
          `
            INSERT OR IGNORE INTO challenges (
              nonce,
              pubkey,
              action,
              expires_at,
              used_at,
              created_at
            ) VALUES (?, ?, ?, ?, NULL, ?)
          `,
        )
        .run(nonce, pubkey, action, expiresAt, nowMs);

      if (result.changes === 1) {
        return nonce;
      }
    }

    throw new StorageConflictError(
      "Failed to allocate a unique challenge nonce",
    );
  }

  getChallenge(nonce: string): ChallengeRecord | null {
    return this.db
      .query<ChallengeRecord, [string]>(
        `
          SELECT nonce, pubkey, action, expires_at AS expiresAt, used_at AS usedAt
          FROM challenges
          WHERE nonce = ?
        `,
      )
      .get(nonce);
  }

  pruneChallenges(nowMs: number): void {
    this.db
      .query(
        `
          DELETE FROM challenges
          WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)
        `,
      )
      .run(nowMs, nowMs - 24 * 60 * 60 * 1000);
  }

  registerSubscription(params: RegisterSubscriptionParams): void {
    const { subscription } = params;
    this.transaction(() =>
      this.registerAssociations(WEB_TABLES, params, [
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        subscription.expirationTime,
      ]),
    );
  }

  registerNativeSubscription(params: RegisterNativeSubscriptionParams): void {
    const { device } = params;
    this.transaction(() =>
      this.registerAssociations(NATIVE_TABLES, params, [
        device.token,
        device.platform,
      ]),
    );
  }

  unregisterSubscriptionPubkeys(
    params: UnregisterSubscriptionPubkeysParams,
  ): UnregisterSubscriptionPubkeysResult {
    return this.transaction(() =>
      this.unregisterAssociations(WEB_TABLES, params, params.endpoint),
    );
  }

  unregisterNativeSubscriptionPubkeys(
    params: UnregisterNativeSubscriptionPubkeysParams,
  ): UnregisterSubscriptionPubkeysResult {
    return this.transaction(() =>
      this.unregisterAssociations(NATIVE_TABLES, params, params.token),
    );
  }

  removeSubscriptionById(subscriptionId: number): void {
    this.removeSubscription(WEB_TABLES, subscriptionId);
  }

  removeNativeSubscriptionById(subscriptionId: number): void {
    this.removeSubscription(NATIVE_TABLES, subscriptionId);
  }

  getSubscriptionsForPubkeys(
    pubkeys: string[],
  ): Map<string, StoredSubscription[]> {
    return groupByPubkey(
      this.getSubscriptionRows<SubscriptionRow>(
        WEB_TABLES,
        "s.endpoint AS endpoint, s.p256dh AS p256dh, s.auth AS auth, s.expiration_time AS expirationTime",
        pubkeys,
      ),
      (row) => ({
        id: row.id,
        endpoint: row.endpoint,
        expirationTime: row.expirationTime,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }),
    );
  }

  getNativeSubscriptionsForPubkeys(
    pubkeys: string[],
  ): Map<string, StoredNativeSubscription[]> {
    return groupByPubkey(
      this.getSubscriptionRows<NativeSubscriptionRow>(
        NATIVE_TABLES,
        "s.platform AS platform, s.token AS token",
        pubkeys,
      ),
      (row) => ({ id: row.id, platform: row.platform, token: row.token }),
    );
  }

  recordSeenEvent(eventId: string, firstSeenAt: number): boolean {
    const result = this.db
      .query(
        `
          INSERT OR IGNORE INTO seen_events (
            event_id,
            first_seen_at
          ) VALUES (?, ?)
        `,
      )
      .run(eventId, firstSeenAt);
    return result.changes === 1;
  }

  pruneSeenEvents(nowMs: number, maxAgeMs: number): void {
    this.db
      .query(
        `
          DELETE FROM seen_events
          WHERE first_seen_at <= ?
        `,
      )
      .run(nowMs - maxAgeMs);
  }

  private getSubscriptionRows<Row extends IdRow & { pubkey: string }>(
    tables: SubscriptionTables,
    selectColumns: string,
    pubkeys: string[],
  ): Row[] {
    const uniquePubkeys = [...new Set(pubkeys)];
    if (uniquePubkeys.length === 0) {
      return [];
    }

    const placeholders = uniquePubkeys.map(() => "?").join(", ");
    return this.db
      .query<Row, string[]>(
        `
          SELECT sp.pubkey AS pubkey, s.id AS id, ${selectColumns}
          FROM ${tables.association} sp
          INNER JOIN ${tables.subscription} s ON s.id = sp.subscription_id
          WHERE sp.pubkey IN (${placeholders})
        `,
      )
      .all(...uniquePubkeys);
  }

  private registerAssociations(
    tables: SubscriptionTables,
    params: SubscriptionAssociationParams,
    columnValues: SQLQueryBindings[],
  ): void {
    if (params.recipientPubkeys.length > params.maxPubkeysPerSubscription) {
      throw new StorageLimitError(
        `Subscriptions may track at most ${params.maxPubkeysPerSubscription} pubkeys`,
      );
    }

    const [key] = columnValues;
    const existingSubscriptionId = this.findSubscriptionId(
      tables,
      key,
      params.installationId,
    );
    const currentPubkeys =
      existingSubscriptionId === null
        ? new Set<string>()
        : this.getSubscriptionPubkeys(tables, existingSubscriptionId);

    for (const pubkey of params.recipientPubkeys) {
      if (currentPubkeys.has(pubkey)) continue;
      const currentCount = this.countSubscriptionsForPubkey(
        tables,
        pubkey,
        existingSubscriptionId,
      );
      if (currentCount >= params.maxSubscriptionsPerPubkey) {
        throw new StorageLimitError(
          `Pubkey ${pubkey} already has the maximum ${params.maxSubscriptionsPerPubkey} subscriptions`,
        );
      }
    }

    this.consumeChallenges(params.consumedChallengeNonces, params.nowMs);

    const subscriptionId = this.upsertSubscription(
      tables,
      existingSubscriptionId,
      params.installationId,
      columnValues,
      params.nowMs,
    );
    if (params.cleanupLegacySubscriptions) {
      this.pruneLegacySubscriptionsForPubkeys(
        tables,
        params.recipientPubkeys,
        subscriptionId,
      );
    }

    this.db
      .query(`DELETE FROM ${tables.association} WHERE subscription_id = ?`)
      .run(subscriptionId);

    for (const pubkey of params.recipientPubkeys) {
      this.db
        .query(
          `
            INSERT INTO ${tables.association} (
              subscription_id,
              pubkey,
              created_at
            ) VALUES (?, ?, ?)
          `,
        )
        .run(subscriptionId, pubkey, params.nowMs);
    }
  }

  private unregisterAssociations(
    tables: SubscriptionTables,
    params: UnregisterPubkeysParams,
    key: string,
  ): UnregisterSubscriptionPubkeysResult {
    const subscriptionId = this.findSubscriptionId(tables, key, null);
    if (subscriptionId === null) {
      return { removedPubkeys: 0, removedSubscription: false };
    }

    this.consumeChallenges(params.consumedChallengeNonces, params.nowMs);

    let removedPubkeys = 0;
    for (const pubkey of params.recipientPubkeys) {
      const result = this.db
        .query(
          `
            DELETE FROM ${tables.association}
            WHERE subscription_id = ? AND pubkey = ?
          `,
        )
        .run(subscriptionId, pubkey);
      removedPubkeys += result.changes;
    }

    const removedSubscription = this.removeSubscriptionIfOrphaned(
      tables,
      subscriptionId,
    );
    return { removedPubkeys, removedSubscription };
  }

  private consumeChallenges(nonces: string[], nowMs: number): void {
    for (const nonce of nonces) {
      const result = this.db
        .query(
          `
            UPDATE challenges
            SET used_at = ?
            WHERE nonce = ? AND used_at IS NULL AND expires_at > ?
          `,
        )
        .run(nowMs, nonce, nowMs);
      if (result.changes !== 1) {
        throw new StorageConflictError("Challenge is expired or already used");
      }
    }
  }

  private upsertSubscription(
    tables: SubscriptionTables,
    existingId: number | null,
    installationId: string | null,
    columnValues: SQLQueryBindings[],
    nowMs: number,
  ): number {
    if (existingId !== null) {
      const assignments = tables.columns.map((column) => `${column} = ?`);
      this.db
        .query(
          `
            UPDATE ${tables.subscription}
            SET ${assignments.join(", ")}, installation_id = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(...columnValues, installationId, nowMs, existingId);
      return existingId;
    }

    const columns = [
      ...tables.columns,
      "installation_id",
      "created_at",
      "updated_at",
    ];
    const placeholders = columns.map(() => "?").join(", ");
    const result = this.db
      .query(
        `
          INSERT INTO ${tables.subscription} (${columns.join(", ")})
          VALUES (${placeholders})
        `,
      )
      .run(...columnValues, installationId, nowMs, nowMs);

    const subscriptionId = readSafeInteger(result.lastInsertRowid);
    if (subscriptionId === null) {
      throw new Error("Subscription rowid exceeds Number.MAX_SAFE_INTEGER");
    }
    return subscriptionId;
  }

  private findSubscriptionId(
    tables: SubscriptionTables,
    key: SQLQueryBindings,
    installationId: string | null,
  ): number | null {
    const byKey = this.db
      .query<
        IdRow,
        [SQLQueryBindings]
      >(`SELECT id FROM ${tables.subscription} WHERE ${tables.key} = ?`)
      .get(key);
    if (byKey !== null) {
      return byKey.id;
    }
    if (installationId === null) {
      return null;
    }
    return (
      this.db
        .query<
          IdRow,
          [string]
        >(`SELECT id FROM ${tables.subscription} WHERE installation_id = ?`)
        .get(installationId)?.id ?? null
    );
  }

  private getSubscriptionPubkeys(
    tables: SubscriptionTables,
    subscriptionId: number,
  ): Set<string> {
    const rows = this.db
      .query<
        { pubkey: string },
        [number]
      >(`SELECT pubkey FROM ${tables.association} WHERE subscription_id = ?`)
      .all(subscriptionId);
    return new Set(rows.map((row) => row.pubkey));
  }

  private pruneLegacySubscriptionsForPubkeys(
    tables: SubscriptionTables,
    pubkeys: readonly string[],
    keepSubscriptionId: number,
  ): void {
    const affectedSubscriptionIds = new Set<number>();

    for (const pubkey of pubkeys) {
      const rows = this.db
        .query<{ subscriptionId: number }, [string, number]>(
          `
            SELECT sp.subscription_id AS subscriptionId
            FROM ${tables.association} sp
            INNER JOIN ${tables.subscription} s ON s.id = sp.subscription_id
            WHERE sp.pubkey = ?
              AND sp.subscription_id != ?
              AND s.installation_id IS NULL
          `,
        )
        .all(pubkey, keepSubscriptionId);

      for (const { subscriptionId } of rows) {
        const result = this.db
          .query(
            `
              DELETE FROM ${tables.association}
              WHERE subscription_id = ? AND pubkey = ?
            `,
          )
          .run(subscriptionId, pubkey);
        if (result.changes > 0) {
          affectedSubscriptionIds.add(subscriptionId);
        }
      }
    }

    for (const subscriptionId of affectedSubscriptionIds) {
      this.removeSubscriptionIfOrphaned(tables, subscriptionId);
    }
  }

  private removeSubscriptionIfOrphaned(
    tables: SubscriptionTables,
    subscriptionId: number,
  ): boolean {
    const remaining = this.db
      .query<
        CountRow,
        [number]
      >(`SELECT COUNT(*) AS total FROM ${tables.association} WHERE subscription_id = ?`)
      .get(subscriptionId);
    if (remaining !== null && remaining.total > 0) {
      return false;
    }
    this.removeSubscription(tables, subscriptionId);
    return true;
  }

  private removeSubscription(
    tables: SubscriptionTables,
    subscriptionId: number,
  ): void {
    this.db
      .query(`DELETE FROM ${tables.subscription} WHERE id = ?`)
      .run(subscriptionId);
  }

  private countSubscriptionsForPubkey(
    tables: SubscriptionTables,
    pubkey: string,
    excludedSubscriptionId: number | null,
  ): number {
    const row = this.db
      .query<CountRow, { $pubkey: string; $excluded: number | null }>(
        `
          SELECT COUNT(*) AS total
          FROM ${tables.association}
          WHERE pubkey = $pubkey
            AND ($excluded IS NULL OR subscription_id != $excluded)
        `,
      )
      .get({ $pubkey: pubkey, $excluded: excludedSubscriptionId });
    return row?.total ?? 0;
  }
}
