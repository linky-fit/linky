import {
  CheckStateEnum,
  hashToCurve,
  Mint,
  MintQuoteState,
} from "@cashu/cashu-ts";
import type { SQL } from "bun";
import { Schema } from "effect";
import { normalizeMintUrl } from "../claim";
import { describeError } from "../responses";
import { ForkSnapshot, UNSETTLED_CLAIM_STATUSES } from "./plan";
import type { CutoverPlan, V1Claim, V3Quote } from "./plan";

const decodeForkSnapshot = Schema.decodeUnknownSync(ForkSnapshot);
const utf8 = new TextEncoder();
const PROOFS_PER_CHECK = 100;
// The fork stores amounts as strings and keeps `dleq`, which old cashu-ts verifies against active keysets only.
const FORK_PROOF = `jsonb_build_object('id', proof->>'id', 'amount', (proof->>'amount')::int,
                                     'secret', proof->>'secret', 'C', proof->>'C')`;

/** One consistent snapshot of everything the cutover copies. */
export async function readFork(fork: SQL): Promise<ForkSnapshot> {
  return fork.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    return decodeForkSnapshot({
      users: await tx`SELECT pubkey, name, mint_url FROM l_users`,
      openQuotes: await tx`
        SELECT id::int, "user", mint_url, mint_pr, cashu_quote_id AS quote_id,
               amount::int, zap_request,
               EXISTS (SELECT 1 FROM l_claims_3 c WHERE c.transaction_id = t.id) AS has_fork_proofs
        FROM l_transactions t WHERE fulfilled IS NOT TRUE ORDER BY id`,
      claims: await tx`
        SELECT c.id::int, c."user", c.mint_url, ${tx.unsafe(FORK_PROOF)} AS proof, c.transaction_id::int,
               t.cashu_quote_id AS quote_id
        FROM l_claims_3 c LEFT JOIN l_transactions t ON t.id = c.transaction_id
        WHERE c.status IN ${tx(UNSETTLED_CLAIM_STATUSES)} ORDER BY c.id`,
      revenue: await tx`
        SELECT quote_id, amount::int, ${tx.unsafe(FORK_PROOF)} AS proof
        FROM l_service_revenue_claims ORDER BY id`,
      claimStatuses: (
        await tx`SELECT DISTINCT status FROM l_claims_3`.values()
      ).flat(),
      spentClaimsReoffered: (
        await tx`
          SELECT EXISTS (SELECT 1 FROM pgmigrations
                         WHERE name = '1794043600000_reoffer-unconfirmed-claims')`.values()
      ).flat()[0],
    });
  });
}

/**
 * Refuses while the fork, v3 or this service holds a connection; call it before `readFork`.
 * An idle pool may hold none, so stopping those containers is what guarantees nothing writes.
 * The caller passes single-connection clients.
 */
export async function assertNoOtherClients(fork: SQL, v3: SQL) {
  for (const [sql, label] of [
    [fork, "fork database"],
    [v3, "v3 database"],
  ] as const) {
    const [row] = await sql`
      SELECT count(*)::int FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()`.values();
    const others = Number(row?.[0]);
    if (others !== 0) {
      throw new Error(
        `${label} has ${others} other client(s); stop them first`,
      );
    }
  }
}

/** Writes the plan into v3's database in one transaction. */
export async function applyPlan(v3: SQL, plan: CutoverPlan): Promise<void> {
  if (plan.problems.length > 0) {
    throw new Error(`the plan has ${plan.problems.length} problem(s)`);
  }

  await v3.begin(async (tx) => {
    const [existing] = await tx`
      SELECT (SELECT count(*) FROM l_users) + (SELECT count(*) FROM mint_quotes)
           + (SELECT count(*) FROM v1_claims) AS rows`.values();
    if (Number(existing?.[0]) !== 0) {
      throw new Error("v3 database already holds users, quotes or claims");
    }

    await tx`
      INSERT INTO l_users (pubkey, name, mint_url, lock_quote)
      SELECT pubkey, name, mint_url, false
      FROM jsonb_to_recordset(${plan.users}::jsonb)
        AS r(pubkey text, name text, mint_url text)`;
    // New quotes have no last_polled_at, and v3 polls those first, so the imported backlog cannot delay them.
    await tx`
      INSERT INTO mint_quotes (unit, mint_url, payment_request, quote_id, expires_at, amount,
                               pubkey, state, serialized_zap_request, locked, last_polled_at)
      SELECT 'sat', mint_url, payment_request, quote_id, expires_at, amount,
             pubkey, 'UNPAID', serialized_zap_request, false, NOW()
      FROM jsonb_to_recordset(${plan.quotes}::jsonb)
        AS r(mint_url text, payment_request text, quote_id text, expires_at timestamptz,
             amount int, pubkey text, serialized_zap_request text)`;
    await tx`
      INSERT INTO v1_claims (mint_url, quote_id, pubkey, amount, proofs, status)
      SELECT mint_url, quote_id, pubkey, amount, proofs, 'ready'
      FROM jsonb_to_recordset(${plan.claims}::jsonb)
        AS r(mint_url text, quote_id text, pubkey text, amount int, proofs jsonb)`;
  });
}

export interface AuditReport {
  quoteStates: Record<string, number>;
  /** Paid at the mint; the worker mints them after the cutover, unless nutshell refuses an expired quote. */
  paidQuotes: V3Quote[];
  /** Issued at the mint with no proofs in the fork, even `spent` ones: minted with random outputs and lost. */
  lostQuotes: V3Quote[];
  quoteErrors: string[];
  unspentSats: { users: number; operator: number };
  settledClaims: number;
  unknownKeysets: string[];
  proofErrors: string[];
}

/** Read-only: asks each mint about the plan's quotes and proofs. */
export async function audit(
  plan: CutoverPlan,
  operatorPubkey: string,
): Promise<AuditReport> {
  const mints = new Map<string, Mint>();
  const mintFor = (url: string) => {
    const normalized = normalizeMintUrl(url);
    const mint = mints.get(normalized) ?? new Mint(normalized);
    mints.set(normalized, mint);
    return mint;
  };

  const report: AuditReport = {
    quoteStates: {},
    paidQuotes: [],
    lostQuotes: [],
    quoteErrors: [],
    unspentSats: { users: 0, operator: 0 },
    settledClaims: 0,
    unknownKeysets: [],
    proofErrors: [],
  };

  for (const quote of plan.quotes) {
    try {
      const { state } = await mintFor(quote.mint_url).checkMintQuoteBolt11(
        quote.quote_id,
      );
      report.quoteStates[state] = (report.quoteStates[state] ?? 0) + 1;
      if (state === MintQuoteState.PAID) report.paidQuotes.push(quote);
      if (state === MintQuoteState.ISSUED && !quote.fork_has_proofs) {
        report.lostQuotes.push(quote);
      }
    } catch (error) {
      report.quoteErrors.push(
        `transaction ${quote.fork_transaction_id}: ${describeError(error)}`,
      );
    }
  }

  const claimsByMint = new Map<string, V1Claim[]>();
  for (const claim of plan.claims) {
    const url = normalizeMintUrl(claim.mint_url);
    claimsByMint.set(url, [...(claimsByMint.get(url) ?? []), claim]);
  }
  for (const [url, claims] of claimsByMint) {
    try {
      const mint = mintFor(url);
      const { keysets } = await mint.getKeySets();
      const known = new Set(keysets.map(({ id }) => id));
      const proofs = claims.flatMap(({ proofs }) => proofs);
      for (const id of new Set(proofs.map(({ id }) => id))) {
        if (!known.has(id)) report.unknownKeysets.push(`${url} ${id}`);
      }
      const stateOf = new Map<string, CheckStateEnum>();
      for (let start = 0; start < proofs.length; start += PROOFS_PER_CHECK) {
        const { states } = await mint.check({
          Ys: proofs.slice(start, start + PROOFS_PER_CHECK).map(proofY),
        });
        for (const { Y, state } of states) stateOf.set(Y, state);
      }
      for (const claim of claims) {
        const states = claim.proofs.map((proof) => stateOf.get(proofY(proof)));
        if (states.every((state) => state === CheckStateEnum.SPENT)) {
          report.settledClaims += 1;
        }
        const sats = claim.proofs
          .filter((_, index) => states[index] === CheckStateEnum.UNSPENT)
          .reduce((total, { amount }) => total + amount, 0);
        report.unspentSats[
          claim.pubkey === operatorPubkey ? "operator" : "users"
        ] += sats;
      }
    } catch (error) {
      report.proofErrors.push(`${url}: ${describeError(error)}`);
    }
  }
  return report;
}

const proofY = ({ secret }: { secret: string }) =>
  hashToCurve(utf8.encode(secret)).toHex(true);
