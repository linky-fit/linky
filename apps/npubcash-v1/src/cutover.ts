import { setGlobalRequestOptions } from "@cashu/cashu-ts";
import { SQL } from "bun";
import { loadConfig } from "./config";
import { buildPlan } from "./cutover/plan";
import type { CutoverPlan, V3Quote } from "./cutover/plan";
import {
  applyPlan,
  assertNoOtherClients,
  audit,
  readFork,
} from "./cutover/run";

const USAGE = `usage: bun cutover.js <plan|audit|apply>

  plan   read the fork and print what apply would copy (read-only)
  audit  plan, then ask the mints about its quotes and proofs (read-only)
  apply  copy into v3's database; stop the fork, v3 and this service first

env: this service's environment plus NPUBCASH_FORK_DATABASE_URL`;

const mode = Bun.argv[2];
if (mode !== "plan" && mode !== "audit" && mode !== "apply") {
  console.error(USAGE);
  process.exit(2);
}

const config = loadConfig(Bun.env);
const { operatorPubkey } = config;
const forkDatabaseUrl = Bun.env.NPUBCASH_FORK_DATABASE_URL?.trim();
if (!forkDatabaseUrl) throw new Error("NPUBCASH_FORK_DATABASE_URL is required");
const fork = new SQL({ url: forkDatabaseUrl, max: 1 });
const v3 = new SQL({ url: config.databaseUrl, max: 1 });

try {
  if (mode === "apply") await assertNoOtherClients(fork, v3);
  const plan = buildPlan(await readFork(fork), {
    operatorPubkey,
    forkMintUrl: config.defaultMintUrl,
  });
  printPlan(plan);
  if (mode === "audit") await printAudit(plan);
  if (mode === "apply") {
    await applyPlan(v3, plan);
    console.info(
      "applied: start npubcash-v3 and npubcash-v1, then switch Caddy",
    );
  }
  if (plan.problems.length > 0) process.exitCode = 1;
} finally {
  await fork.close();
  await v3.close();
}

function printPlan({ users, quotes, claims, problems }: CutoverPlan) {
  const sats = (rows: readonly { amount: number }[]) =>
    rows.reduce((total, { amount }) => total + amount, 0);
  const revenue = claims.filter(({ pubkey }) => pubkey === operatorPubkey);
  console.info(
    [
      `users: ${users.length} (${users.filter(({ name }) => name).length} named)`,
      `open quotes -> mint_quotes UNPAID: ${quotes.length} (${sats(quotes)} sat)`,
      `  still polled a day after the cutover: ${quotes.filter(({ expires_at }) => Date.parse(expires_at) > Date.now() + 86_400_000).length}`,
      `fork proofs -> v1_claims ready: ${claims.length - revenue.length} claims (${sats(claims) - sats(revenue)} sat at face value)`,
      `username fees and the operator's own proofs -> v1_claims ready: ${revenue.length} claims (${sats(revenue)} sat at face value)`,
      `problems: ${problems.length}`,
      ...problems.map((problem) => `  ${problem}`),
    ].join("\n"),
  );
}

async function printAudit(plan: CutoverPlan) {
  setGlobalRequestOptions({ requestTimeout: 10_000 });
  const report = await audit(plan, operatorPubkey);
  const describe = (quote: V3Quote) =>
    `  transaction ${quote.fork_transaction_id}, ${quote.amount} sat, ${quote.pubkey}, ${quote.mint_url} ${quote.quote_id}`;
  console.info(
    [
      `quote states at the mints: ${JSON.stringify(report.quoteStates)}`,
      `paid, not minted (the worker mints them; nutshell refuses expired ones): ${report.paidQuotes.length}`,
      ...report.paidQuotes.map(describe),
      `issued with no proofs in the fork (lost): ${report.lostQuotes.length}`,
      ...report.lostQuotes.map(describe),
      `unspent sat in imported claims: users ${report.unspentSats.users}, operator ${report.unspentSats.operator}`,
      `imported claims already fully spent: ${report.settledClaims}`,
      `proofs on keysets the mint does not list: ${report.unknownKeysets.length}`,
      ...report.unknownKeysets.map((keyset) => `  ${keyset}`),
      `errors: ${report.quoteErrors.length + report.proofErrors.length}`,
      ...[...report.quoteErrors, ...report.proofErrors].map(
        (error) => `  ${error}`,
      ),
    ].join("\n"),
  );
}
