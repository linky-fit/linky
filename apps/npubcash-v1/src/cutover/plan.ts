import { Schema } from "effect";
import { decode as decodeInvoice } from "light-bolt11-decoder";
import { nip19 } from "nostr-tools";
import { StoredProof } from "../db";
import { isValidUsername } from "../username";

/** The fork's rows as `readFork` selects them. */
export const ForkSnapshot = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      pubkey: Schema.String,
      name: Schema.NullOr(Schema.String),
      mint_url: Schema.NullOr(Schema.String),
    }),
  ),
  openQuotes: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      user: Schema.String,
      mint_url: Schema.String,
      mint_pr: Schema.String,
      quote_id: Schema.NullOr(Schema.String),
      amount: Schema.NullOr(Schema.Number),
      zap_request: Schema.Unknown,
      has_fork_proofs: Schema.Boolean,
    }),
  ),
  claims: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      user: Schema.String,
      mint_url: Schema.String,
      proof: StoredProof,
      transaction_id: Schema.NullOr(Schema.Number),
      quote_id: Schema.NullOr(Schema.String),
    }),
  ),
  revenue: Schema.Array(
    Schema.Struct({
      quote_id: Schema.String,
      amount: Schema.Number,
      proof: StoredProof,
    }),
  ),
  claimStatuses: Schema.Array(Schema.String),
  /** Fork migration 1794043600000 reopened every `spent` row; until it runs, `spent` rows may hold unspent proofs. */
  spentClaimsReoffered: Schema.Boolean,
});
export type ForkSnapshot = typeof ForkSnapshot.Type;
type ForkClaim = ForkSnapshot["claims"][number];

export interface V3User {
  pubkey: string;
  name: string | null;
  mint_url: string;
}

export interface V3Quote {
  mint_url: string;
  payment_request: string;
  quote_id: string;
  amount: number;
  pubkey: string;
  expires_at: string;
  serialized_zap_request: string | null;
  fork_transaction_id: number;
  /** The fork holds proofs for it, so the mint reporting it `ISSUED` loses nothing. */
  fork_has_proofs: boolean;
}

export interface V1Claim {
  mint_url: string;
  quote_id: string;
  pubkey: string;
  amount: number;
  proofs: readonly StoredProof[];
}

export interface CutoverPlan {
  users: V3User[];
  quotes: V3Quote[];
  claims: V1Claim[];
  /** Anything here blocks `apply`. */
  problems: string[];
}

export interface PlanOptions {
  operatorPubkey: string;
  /** The fork's `MINTURL`, verbatim: the only mint it settled username fees on. */
  forkMintUrl: string;
}

// The fork's claim handout states; `spent` means the mint reported every proof spent.
export const UNSETTLED_CLAIM_STATUSES = ["ready", "inflight"];
const KNOWN_CLAIM_STATUSES = [...UNSETTLED_CLAIM_STATUSES, "spent"];
const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INVOICE_EXPIRY_SECONDS = 3600;

export function buildPlan(
  fork: ForkSnapshot,
  { operatorPubkey, forkMintUrl }: PlanOptions,
): CutoverPlan {
  const problems: string[] = [];
  const pubkeyByName = new Map(
    fork.users.flatMap(({ name, pubkey }) =>
      name ? [[name.toLowerCase(), pubkey] as const] : [],
    ),
  );
  // Fork rows name their owner by the LNURL parameter: an npub or a username.
  const ownerOf = (user: string, source: string) => {
    const pubkey = user.startsWith("npub1")
      ? npubToHex(user)
      : pubkeyByName.get(user.toLowerCase());
    if (!pubkey) problems.push(`${source}: owner "${user}" has no pubkey`);
    return pubkey;
  };
  const checkMintUrl = (url: string, source: string) => {
    if (!URL.canParse(url)) {
      problems.push(`${source}: unreadable mint URL "${url}"`);
    }
  };

  if (!fork.spentClaimsReoffered) {
    problems.push(
      "the fork has not run migration 1794043600000_reoffer-unconfirmed-claims, so its spent rows may hold unspent proofs",
    );
  }
  for (const status of fork.claimStatuses) {
    if (!KNOWN_CLAIM_STATUSES.includes(status)) {
      problems.push(`l_claims_3 has rows in unknown status "${status}"`);
    }
  }

  const users = fork.users.map(({ pubkey, name, mint_url }): V3User => {
    const lowered = name?.toLowerCase() ?? null;
    if (!HEX_PUBKEY.test(pubkey)) {
      problems.push(`user "${pubkey}": not a hex pubkey`);
    }
    if (lowered !== null && !isValidUsername(lowered)) {
      problems.push(`user ${pubkey}: v3 rejects the name "${name}"`);
    }
    if (mint_url !== null) checkMintUrl(mint_url, `user ${pubkey}`);
    return { pubkey, name: lowered, mint_url: mint_url ?? forkMintUrl };
  });
  for (const name of duplicates(users.flatMap(({ name }) => name ?? []))) {
    problems.push(`name "${name}" belongs to several users`);
  }

  const quotes = fork.openQuotes.flatMap((row): V3Quote[] => {
    const source = `transaction ${row.id}`;
    const pubkey = ownerOf(row.user, source);
    const invoice = readInvoice(row.mint_pr);
    const amount = row.amount ?? invoice?.amountSat ?? null;
    if (!invoice) problems.push(`${source}: unreadable invoice`);
    if (!row.quote_id) problems.push(`${source}: no cashu quote id`);
    if (amount === null || amount <= 0) problems.push(`${source}: no amount`);
    if (invoice?.amountSat != null && amount !== invoice.amountSat) {
      problems.push(
        `${source}: amount ${amount} differs from the invoice's ${invoice.amountSat}`,
      );
    }
    checkMintUrl(row.mint_url, source);
    if (!pubkey || !invoice || !row.quote_id || !amount) return [];
    return [
      {
        mint_url: row.mint_url,
        payment_request: row.mint_pr,
        quote_id: row.quote_id,
        amount,
        pubkey,
        expires_at: quoteExpiry(invoice.expiresAtMs).toISOString(),
        serialized_zap_request:
          row.zap_request === null ? null : JSON.stringify(row.zap_request),
        fork_transaction_id: row.id,
        fork_has_proofs: row.has_fork_proofs,
      },
    ];
  });

  const forkClaims = [
    ...groupBy(fork.claims, (claim) =>
      claim.transaction_id === null
        ? `claim ${claim.id}`
        : `transaction ${claim.transaction_id}`,
    ),
  ].flatMap(([source, group]): V1Claim[] => {
    const [first] = group;
    if (!first) return [];
    if (new Set(group.map(({ user }) => user)).size > 1) {
      problems.push(`${source}: proofs of several owners`);
      return [];
    }
    if (new Set(group.map(({ mint_url }) => mint_url)).size > 1) {
      problems.push(`${source}: proofs of several mints`);
      return [];
    }
    checkMintUrl(first.mint_url, source);
    const pubkey = ownerOf(first.user, source);
    if (!pubkey) return [];
    return [
      {
        mint_url: first.mint_url,
        quote_id: forkClaimQuoteId(first),
        pubkey,
        amount: sum(group.map(({ proof }) => proof.amount)),
        proofs: group.map(({ proof }) => proof),
      },
    ];
  });

  // One row per proof, each repeating the quote's total amount.
  const revenueClaims = [
    ...groupBy(fork.revenue, ({ quote_id }) => quote_id),
  ].flatMap(([quoteId, group]): V1Claim[] =>
    group[0]
      ? [
          {
            mint_url: forkMintUrl,
            quote_id: quoteId,
            pubkey: operatorPubkey,
            amount: group[0].amount,
            proofs: group.map(({ proof }) => proof),
          },
        ]
      : [],
  );

  const claims = [...forkClaims, ...revenueClaims];
  for (const key of duplicates(
    claims.map(({ mint_url, quote_id }) => `${mint_url} ${quote_id}`),
  )) {
    problems.push(`several claims share the key ${key}`);
  }

  return { users, quotes, claims, problems };
}

/**
 * v3 checks an `UNPAID` quote at the mint once more after `expires_at` before
 * it gives up, and nobody can pay an expired invoice, so a day past the
 * invoice's expiry catches every payment while keeping long-dead invoices out
 * of the polling queue after that single check.
 */
const quoteExpiry = (invoiceExpiresAtMs: number) =>
  new Date(invoiceExpiresAtMs + DAY_MS);

const forkClaimQuoteId = (claim: ForkClaim) =>
  claim.transaction_id === null
    ? `fork-claim:${claim.id}`
    : (claim.quote_id ?? `fork:${claim.transaction_id}`);

function readInvoice(invoice: string) {
  try {
    const { sections } = decodeInvoice(invoice);
    const valueOf = (name: string) => {
      const section = sections.find((candidate) => candidate.name === name);
      return section && "value" in section ? section.value : undefined;
    };
    const timestamp = Number(valueOf("timestamp"));
    const expiry = Number(valueOf("expiry") ?? DEFAULT_INVOICE_EXPIRY_SECONDS);
    const amountMsat = Number(valueOf("amount"));
    if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(expiry)) {
      return null;
    }
    return {
      expiresAtMs: (timestamp + expiry) * 1000,
      amountSat: Number.isSafeInteger(amountMsat)
        ? Math.ceil(amountMsat / 1000)
        : null,
    };
  } catch {
    return null;
  }
}

function npubToHex(npub: string) {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === "npub" ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function duplicates(values: readonly string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);
