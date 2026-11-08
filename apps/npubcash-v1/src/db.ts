import { SQL } from "bun";
import { Schema } from "effect";

export const ClaimStatus = Schema.Literals([
  "unpaid",
  "minting",
  "ready",
  "spent",
  "issued_elsewhere",
  "expired",
]);
export type ClaimStatus = typeof ClaimStatus.Type;

export const StoredProof = Schema.Struct({
  id: Schema.String,
  amount: Schema.Number,
  secret: Schema.String,
  C: Schema.String,
});
export type StoredProof = typeof StoredProof.Type;

const ClaimRow = Schema.Struct({
  mint_url: Schema.String,
  quote_id: Schema.String,
  pubkey: Schema.String,
  amount: Schema.Number,
  output_amounts: Schema.NullOr(Schema.Array(Schema.Number)),
  proofs: Schema.NullOr(Schema.Array(StoredProof)),
  status: ClaimStatus,
});
export type ClaimRow = typeof ClaimRow.Type;

const decodeClaimRows = Schema.decodeUnknownSync(Schema.Array(ClaimRow));
const decodeOutputAmounts = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ output_amounts: Schema.Array(Schema.Number) })),
);

export interface PaidQuote {
  mint_url: string;
  quote_id: string;
  pubkey: string;
  amount: number;
}

export interface V3User {
  name: string | null;
  mint_url: string | null;
}

export type ClaimKey = Pick<ClaimRow, "mint_url" | "quote_id">;

/** `v1_claims` is this service's only table; everything else belongs to v3. */
export class Database {
  readonly sql: SQL;

  constructor(url: string) {
    this.sql = new SQL(url);
  }

  async migrate(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS v1_claims (
        mint_url TEXT NOT NULL,
        quote_id TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        amount INTEGER NOT NULL,
        output_amounts JSONB,
        proofs JSONB,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (mint_url, quote_id)
      )`;
  }

  close(): Promise<void> {
    return this.sql.close();
  }

  async claimsWithStatus(status: ClaimStatus): Promise<readonly ClaimRow[]> {
    return decodeClaimRows(
      await this.sql`
        SELECT * FROM v1_claims
        WHERE status = ${status} ORDER BY created_at`,
    );
  }

  async claim(key: ClaimKey): Promise<ClaimRow | undefined> {
    const [row] = decodeClaimRows(
      await this.sql`
        SELECT * FROM v1_claims
        WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id}`,
    );
    return row;
  }

  async readyClaimsOf(pubkey: string, limit: number) {
    return decodeClaimRows(
      await this.sql`
        SELECT * FROM v1_claims
        WHERE pubkey = ${pubkey} AND status = 'ready'
        ORDER BY created_at LIMIT ${limit}`,
    );
  }

  /** Returns the row only when this call inserted it. */
  async insertClaim(
    row: Omit<ClaimRow, "proofs">,
  ): Promise<ClaimRow | undefined> {
    const [inserted] = decodeClaimRows(
      await this.sql`
        INSERT INTO v1_claims (mint_url, quote_id, pubkey, amount, output_amounts, status)
        VALUES (${row.mint_url}, ${row.quote_id}, ${row.pubkey}, ${row.amount},
                ${row.output_amounts}, ${row.status})
        ON CONFLICT (mint_url, quote_id) DO NOTHING
        RETURNING *`,
    );
    return inserted;
  }

  /** Moves a row on only from the status the caller read, so concurrent callers cannot both move it. */
  async moveClaim(
    key: ClaimKey,
    from: ClaimStatus,
    to: ClaimStatus,
  ): Promise<boolean> {
    const result = await this.sql`
      UPDATE v1_claims SET status = ${to}
      WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id} AND status = ${from}`;
    return result.count > 0;
  }

  /** Stored before the first mint call and never changed, so every retry derives the same outputs. */
  async fixOutputAmounts(
    key: ClaimKey,
    amounts: readonly number[],
  ): Promise<readonly number[]> {
    const [row] = decodeOutputAmounts(
      await this.sql`
        UPDATE v1_claims SET output_amounts = COALESCE(output_amounts, ${amounts})
        WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id}
        RETURNING output_amounts`,
    );
    if (!row) throw new Error(`claim ${key.quote_id} disappeared`);
    return row.output_amounts;
  }

  async deleteUnpaidClaim(key: ClaimKey): Promise<void> {
    await this.sql`
      DELETE FROM v1_claims
      WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id} AND status = 'unpaid'`;
  }

  /**
   * Stores the proofs and marks v3's quote `ISSUED` together, so a crash leaves neither.
   * Overrides `issued_elsewhere`, which a concurrent caller sets when it sees our own mint finish first.
   */
  async storeProofs(
    key: ClaimKey,
    proofs: readonly StoredProof[],
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        UPDATE v1_claims SET proofs = ${proofs}, status = 'ready'
        WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id}
          AND status IN ('minting', 'issued_elsewhere')`;
      await tx`
        UPDATE mint_quotes SET state = 'ISSUED', paid_at = COALESCE(paid_at, NOW())
        WHERE mint_url = ${key.mint_url} AND quote_id = ${key.quote_id} AND state <> 'ISSUED'`;
    });
  }

  async markSpent(keys: readonly ClaimKey[]): Promise<void> {
    for (const key of keys) await this.moveClaim(key, "ready", "spent");
  }

  /** v3 quotes this service still has to mint, soonest expiry first. */
  async unclaimedPaidQuotes(limit: number): Promise<PaidQuote[]> {
    return await this.sql`
      SELECT q.mint_url, q.quote_id, q.pubkey, q.amount FROM mint_quotes q
      WHERE q.state = 'PAID' AND q.locked = false AND q.unit = 'sat'
        AND NOT EXISTS (
          SELECT 1 FROM v1_claims c
          WHERE c.mint_url = q.mint_url AND c.quote_id = q.quote_id
        )
      ORDER BY q.expires_at LIMIT ${limit}`;
  }

  async user(pubkey: string): Promise<V3User | undefined> {
    const [user]: V3User[] = await this.sql`
      SELECT name, mint_url FROM l_users WHERE pubkey = ${pubkey}`;
    return user;
  }

  async nameTaken(name: string): Promise<boolean> {
    const [row]: { taken: boolean }[] = await this.sql`
      SELECT EXISTS (SELECT 1 FROM l_users WHERE lower(name) = ${name}) AS taken`;
    return row?.taken === true;
  }

  async setMint(pubkey: string, mintUrl: string): Promise<void> {
    await this.sql`
      INSERT INTO l_users (pubkey, mint_url) VALUES (${pubkey}, ${mintUrl})
      ON CONFLICT (pubkey) DO UPDATE SET mint_url = ${mintUrl}`;
  }

  /** Sets a name only on an account without one; the unique index on `name` decides a race between buyers. */
  async setName(
    pubkey: string,
    name: string,
    defaultMintUrl: string,
  ): Promise<boolean> {
    const result = await this.sql`
      INSERT INTO l_users (pubkey, mint_url, name)
      VALUES (${pubkey}, ${defaultMintUrl}, ${name})
      ON CONFLICT (pubkey) DO UPDATE
        SET name = ${name}, mint_url = COALESCE(l_users.mint_url, ${defaultMintUrl})
        WHERE l_users.name IS NULL`;
    return result.count > 0;
  }
}
