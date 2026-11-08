import { describe, expect, test } from "bun:test";
import { nip19 } from "nostr-tools";
import { buildPlan } from "./plan";
import type { ForkSnapshot } from "./plan";

// BOLT11 spec vectors: 250,000 sat expiring 60 s after 1496314658, and one with no amount or expiry.
const INVOICE =
  "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";
const AMOUNTLESS_INVOICE =
  "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql";
const DAY_MS = 86_400_000;

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const operator = "c".repeat(64);
const options = { operatorPubkey: operator, forkMintUrl: "https://cashu.cz" };
const proof = (amount: number, secret: string) => ({
  id: "00ad268c4d1f5826",
  amount,
  secret,
  C: `02${secret}`,
});

const snapshot = (overrides: Partial<ForkSnapshot> = {}): ForkSnapshot => ({
  users: [
    { pubkey: alice, name: "alice", mint_url: "https://cashu.cz/" },
    { pubkey: bob, name: null, mint_url: null },
  ],
  openQuotes: [],
  claims: [],
  revenue: [],
  claimStatuses: ["ready", "inflight", "spent"],
  spentClaimsReoffered: true,
  ...overrides,
});

describe("buildPlan", () => {
  test("copies users, giving one without a mint the fork's default", () => {
    const plan = buildPlan(snapshot(), options);
    expect(plan.problems).toEqual([]);
    expect(plan.users).toEqual([
      { pubkey: alice, name: "alice", mint_url: "https://cashu.cz/" },
      { pubkey: bob, name: null, mint_url: "https://cashu.cz" },
    ]);
  });

  test("imports open quotes for npub and name owners, a day past the invoice's expiry", () => {
    const zapRequest = { kind: 9734, tags: [] };
    const plan = buildPlan(
      snapshot({
        openQuotes: [
          {
            id: 7,
            user: nip19.npubEncode(bob),
            mint_url: "https://cashu.cz/",
            mint_pr: INVOICE,
            quote_id: "q7",
            amount: null,
            zap_request: zapRequest,
            has_fork_proofs: false,
          },
          {
            id: 8,
            user: "Alice",
            mint_url: "https://cashu.cz",
            mint_pr: AMOUNTLESS_INVOICE,
            quote_id: "q8",
            amount: 21,
            zap_request: null,
            has_fork_proofs: true,
          },
        ],
      }),
      options,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.quotes).toEqual([
      {
        mint_url: "https://cashu.cz/",
        payment_request: INVOICE,
        quote_id: "q7",
        amount: 250_000,
        pubkey: bob,
        expires_at: new Date((1496314658 + 60) * 1000 + DAY_MS).toISOString(),
        serialized_zap_request: JSON.stringify(zapRequest),
        fork_transaction_id: 7,
        fork_has_proofs: false,
      },
      {
        mint_url: "https://cashu.cz",
        payment_request: AMOUNTLESS_INVOICE,
        quote_id: "q8",
        amount: 21,
        pubkey: alice,
        expires_at: new Date((1496314658 + 3600) * 1000 + DAY_MS).toISOString(),
        serialized_zap_request: null,
        fork_transaction_id: 8,
        fork_has_proofs: true,
      },
    ]);
  });

  test("groups fork proofs per transaction and fee proofs per quote", () => {
    const plan = buildPlan(
      snapshot({
        claims: [
          {
            id: 1,
            user: "alice",
            mint_url: "https://cashu.cz/",
            proof: proof(2, "a1"),
            transaction_id: 10,
            quote_id: "q10",
          },
          {
            id: 2,
            user: "alice",
            mint_url: "https://cashu.cz/",
            proof: proof(8, "a2"),
            transaction_id: 10,
            quote_id: "q10",
          },
          {
            id: 3,
            user: nip19.npubEncode(bob),
            mint_url: "https://mint.lnpay.cz/",
            proof: proof(4, "b1"),
            transaction_id: 11,
            quote_id: null,
          },
          {
            id: 4,
            user: nip19.npubEncode(bob),
            mint_url: "https://mint.lnpay.cz/",
            proof: proof(1, "b2"),
            transaction_id: null,
            quote_id: null,
          },
        ],
        revenue: [
          { quote_id: "fee1", amount: 5000, proof: proof(4096, "f1") },
          { quote_id: "fee1", amount: 5000, proof: proof(904, "f2") },
        ],
      }),
      options,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.claims).toEqual([
      {
        mint_url: "https://cashu.cz/",
        quote_id: "q10",
        pubkey: alice,
        amount: 10,
        proofs: [proof(2, "a1"), proof(8, "a2")],
      },
      {
        mint_url: "https://mint.lnpay.cz/",
        quote_id: "fork:11",
        pubkey: bob,
        amount: 4,
        proofs: [proof(4, "b1")],
      },
      {
        mint_url: "https://mint.lnpay.cz/",
        quote_id: "fork-claim:4",
        pubkey: bob,
        amount: 1,
        proofs: [proof(1, "b2")],
      },
      {
        mint_url: "https://cashu.cz",
        quote_id: "fee1",
        pubkey: operator,
        amount: 5000,
        proofs: [proof(4096, "f1"), proof(904, "f2")],
      },
    ]);
  });

  test("reports everything apply must not guess at", () => {
    const plan = buildPlan(
      snapshot({
        users: [
          { pubkey: alice, name: "alice", mint_url: null },
          { pubkey: bob, name: "ALICE", mint_url: null },
          { pubkey: operator, name: "a-b", mint_url: "cashu" },
        ],
        openQuotes: [
          {
            id: 1,
            user: "carol",
            mint_url: "https://cashu.cz",
            mint_pr: INVOICE,
            quote_id: "q1",
            amount: null,
            zap_request: null,
            has_fork_proofs: false,
          },
          {
            id: 2,
            user: "alice",
            mint_url: "https://cashu.cz",
            mint_pr: "lnbc-garbage",
            quote_id: null,
            amount: null,
            zap_request: null,
            has_fork_proofs: false,
          },
          {
            id: 4,
            user: "alice",
            mint_url: "cashu.cz",
            mint_pr: INVOICE,
            quote_id: "q4",
            amount: 21,
            zap_request: null,
            has_fork_proofs: false,
          },
        ],
        claims: [
          {
            id: 5,
            user: "alice",
            mint_url: "https://cashu.cz",
            proof: proof(1, "x"),
            transaction_id: 3,
            quote_id: "q3",
          },
          {
            id: 6,
            user: "npub1nonsense",
            mint_url: "https://cashu.cz",
            proof: proof(1, "y"),
            transaction_id: 3,
            quote_id: "q3",
          },
        ],
        claimStatuses: ["ready", "withdrawn"],
        spentClaimsReoffered: false,
      }),
      options,
    );
    expect(plan.problems).toEqual([
      "the fork has not run migration 1794043600000_reoffer-unconfirmed-claims, so its spent rows may hold unspent proofs",
      'l_claims_3 has rows in unknown status "withdrawn"',
      `user ${operator}: v3 rejects the name "a-b"`,
      `user ${operator}: unreadable mint URL "cashu"`,
      'name "alice" belongs to several users',
      'transaction 1: owner "carol" has no pubkey',
      "transaction 2: unreadable invoice",
      "transaction 2: no cashu quote id",
      "transaction 2: no amount",
      "transaction 4: amount 21 differs from the invoice's 250000",
      'transaction 4: unreadable mint URL "cashu.cz"',
      "transaction 3: proofs of several owners",
    ]);
  });
});
