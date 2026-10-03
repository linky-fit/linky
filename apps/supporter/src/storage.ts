import {
  Pubkey,
  RumorId,
  SupporterResult,
  SupporterTier,
} from "@linky-fit/linkstr";
import type { StringStorage } from "@linky-fit/linkstr";
import { Database } from "bun:sqlite";
import { Redacted, Schema } from "effect";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** SHA-256 of a token's text: the one key a payment is deduplicated on. */
export const TokenHash = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.brand("TokenHash"),
);
export type TokenHash = typeof TokenHash.Type;

/**
 * `receiving`: recorded, the token not yet received (or a receive to retry);
 * `deferred`: its mint was down, linkshu keeps the token for a retry;
 * `ready`: the result is stored and queued (or about to be) in the outbox;
 * `delivered`: a relay accepted the result.
 */
export const PaymentState = Schema.Literal(
  "receiving",
  "deferred",
  "ready",
  "delivered",
);
export type PaymentState = typeof PaymentState.Type;

const PaymentFields = {
  tokenHash: TokenHash,
  sender: Pubkey,
  rumorId: RumorId,
  /** The token itself, so a retry can receive it again; it spends like cash. */
  tokenText: Schema.Redacted(Schema.String),
  /** The token's face value in sat, before the mint's fee; null when unreadable. */
  amount: Schema.NullOr(Schema.Int),
  tier: Schema.NullOr(SupporterTier),
  state: PaymentState,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
};

export class Payment extends Schema.Class<Payment>("Payment")({
  ...PaymentFields,
  result: Schema.NullOr(SupporterResult),
}) {}

const PaymentRow = Schema.Struct({
  ...PaymentFields,
  result: Schema.NullOr(Schema.parseJson(SupporterResult)),
});
const decodePaymentRow = Schema.decodeUnknownSync(PaymentRow);
const encodeResult = Schema.encodeSync(Schema.parseJson(SupporterResult));

export interface PaymentPatch {
  readonly state: PaymentState;
  readonly result?: SupporterResult;
}

export interface PaymentStore {
  readonly findPayment: (tokenHash: TokenHash) => Payment | null;
  readonly insertPayment: (payment: Payment) => void;
  readonly updatePayment: (
    tokenHash: TokenHash,
    patch: PaymentPatch,
    nowMs: number,
  ) => void;
  /** Payments still waiting on a receive or a delivery, oldest first. */
  readonly unfinishedPayments: () => ReadonlyArray<Payment>;
}

const PAYMENT_COLUMNS = `
  token_hash AS tokenHash, sender, rumor_id AS rumorId, token_text AS tokenText,
  amount, tier, state, result, created_at AS createdAt, updated_at AS updatedAt
`;

/**
 * The service's one SQLite file: linkshu's wallet ports (see
 * `linkshuStores.ts`), linkstr's outbox and inbox cursor, payments and the
 * auto-reply log.
 */
export class SupporterStorage implements PaymentStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    // The CLI commands open the same file while the service runs.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS linkshu_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS linkshu_leases (
        key TEXT PRIMARY KEY,
        lease TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS linkshu_proofs (
        id TEXT PRIMARY KEY,
        row TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS linkshu_operations (
        id TEXT PRIMARY KEY,
        row TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS linkstr_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        token_hash TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        rumor_id TEXT NOT NULL,
        token_text TEXT NOT NULL,
        amount INTEGER,
        tier TEXT,
        state TEXT NOT NULL,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payments_state ON payments (state);
      CREATE TABLE IF NOT EXISTS auto_replies (
        sender TEXT NOT NULL,
        day TEXT NOT NULL,
        PRIMARY KEY (sender, day)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  readonly linkstrStorage: StringStorage = {
    getItem: (key) =>
      this.db
        .query<
          { value: string },
          [string]
        >("SELECT value FROM linkstr_kv WHERE key = ?")
        .get(key)?.value ?? null,
    setItem: (key, value) => {
      this.db
        .query(
          "INSERT INTO linkstr_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(key, value);
    },
  };

  findPayment(tokenHash: TokenHash): Payment | null {
    const row = this.db
      .query(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE token_hash = ?`)
      .get(tokenHash);
    return row === null ? null : new Payment(decodePaymentRow(row));
  }

  insertPayment(payment: Payment): void {
    this.db
      .query(
        `INSERT INTO payments (
          token_hash, sender, rumor_id, token_text, amount, tier, state, result,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payment.tokenHash,
        payment.sender,
        payment.rumorId,
        Redacted.value(payment.tokenText),
        payment.amount,
        payment.tier,
        payment.state,
        payment.result === null ? null : encodeResult(payment.result),
        payment.createdAt,
        payment.updatedAt,
      );
  }

  updatePayment(tokenHash: TokenHash, patch: PaymentPatch, nowMs: number) {
    this.db
      .query(
        `UPDATE payments
         SET state = ?, result = COALESCE(?, result), updated_at = ?
         WHERE token_hash = ?`,
      )
      .run(
        patch.state,
        patch.result === undefined ? null : encodeResult(patch.result),
        nowMs,
        tokenHash,
      );
  }

  unfinishedPayments(): ReadonlyArray<Payment> {
    return this.db
      .query(
        `SELECT ${PAYMENT_COLUMNS} FROM payments
         WHERE state != 'delivered' ORDER BY created_at, token_hash`,
      )
      .all()
      .map((row) => new Payment(decodePaymentRow(row)));
  }

  /** True when this call took the sender's one auto-reply for `day`. */
  claimAutoReply(sender: Pubkey, day: string): boolean {
    return (
      this.db
        .query("INSERT OR IGNORE INTO auto_replies (sender, day) VALUES (?, ?)")
        .run(sender, day).changes === 1
    );
  }
}
