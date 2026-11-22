import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OutputData, type Proof } from "@cashu/cashu-ts";
import { cashuProofIdFor } from "@linky-fit/linksync";
import { expect, type Locator, type Page } from "@playwright/test";
import { Schema } from "effect";
import {
  loadMintWallet,
  mintUrl,
  targetMintUrl,
} from "../../../packages/linkshu/tests/integration/helpers";
import { readBalanceSat } from "../tests/helpers/appState";
import { addContactByNpub } from "../tests/helpers/contacts";
import { createSeedIdentity } from "../tests/helpers/identity";
import {
  shardIndexes,
  shardOwnerId,
  shardRows,
  upsertRow,
} from "../tests/helpers/linkyHooks";
import { enterAmount, test } from "../tests/helpers/recurringPayments";

const listEnv = (name: string, fallback: string): string[] =>
  (process.env[name] ?? fallback).split(",").filter(Boolean);
const numbersEnv = (name: string, fallback: string): number[] =>
  listEnv(name, fallback).map(Number);

/** `amount` is what the payment sends; `spend` is the fresh proof added to the wallet before each one. */
const FLOWS = {
  /** Cashu to a contact: pay-send tap until "Sent". */
  cashu: { amount: 32, spend: 64 },
  /** An invoice under the auto-pay limit: Paste tap until "Sent". */
  lightning: { amount: 32, spend: 64 },
  /** An invoice above the 10 000 sat auto-pay limit: the dialog's Pay tap until "Sent". */
  "lightning-confirm": { amount: 10_240, spend: 16_384 },
} as const;
type Flow = keyof typeof FLOWS;
const isFlow = (flow: string): flow is Flow => flow in FLOWS;

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const FLOW_NAMES = listEnv("BENCH_FLOWS", Object.keys(FLOWS).join(",")).map(
  (flow) => {
    if (!isFlow(flow)) throw new Error(`unknown flow ${flow}`);
    return flow;
  },
);
/** Available proofs in the wallet before each payment. */
const PROOF_COUNTS = numbersEnv("BENCH_PROOFS", "5,128,512");
/** Added to every request to a mint's /v1/ API. */
const LATENCIES_MS = numbersEnv("BENCH_LATENCY", "0,50,150");
/** Chromium CPU slowdown factor; 4–6 is roughly a mid-range phone. */
const CPU_THROTTLE = Number(process.env.BENCH_CPU_THROTTLE ?? 1);
const LABEL = process.env.BENCH_LABEL ?? "payments";
const FILLER_SAT = 1024;

const now = (): number => performance.timeOrigin + performance.now();

interface MintRequest {
  readonly path: string;
  readonly start: number;
  end?: number;
}

/** Delays the page's mint API requests by `state.delayMs` and logs each one. */
const routeMints = async (page: Page) => {
  const state = { delayMs: 0, requests: new Array<MintRequest>() };
  const origins = [mintUrl, targetMintUrl].map((url) => new URL(url).origin);
  await page.context().route(
    (url) => origins.includes(url.origin) && url.pathname.startsWith("/v1/"),
    async (route) => {
      const request: MintRequest = {
        path: new URL(route.request().url()).pathname,
        start: now(),
      };
      state.requests.push(request);
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      const response = await route.fetch().catch(() => null);
      request.end = now();
      await (response ? route.fulfill({ response }) : route.abort());
    },
  );
  return state;
};

/** Requests started in [from, to], and the time at least one of them was in flight. */
const mintTraffic = (
  requests: ReadonlyArray<MintRequest>,
  from: number,
  to: number,
) => {
  const inWindow = requests.filter(({ start }) => start >= from && start <= to);
  let busyMs = 0;
  let busyUntil = from;
  for (const { start, end = to } of inWindow) {
    const clipped = Math.min(end, to);
    busyMs += Math.max(0, clipped - Math.max(start, busyUntil));
    busyUntil = Math.max(busyUntil, clipped);
  }
  return {
    mintRequests: inWindow.length,
    mintMs: Math.round(busyMs),
    paths: inWindow.map(({ path }) => path),
  };
};

declare global {
  interface Window {
    __bench?: { tapAt?: number; sentAt?: number };
  }
}

const sentStatus = (page: Page) =>
  page.getByRole("status").getByText("Sent", { exact: true });

/** Taps `button` and returns the page's own times of the tap and of "Sent" showing up. */
const timeTap = async (page: Page, button: Locator) => {
  await expect(sentStatus(page)).toBeHidden({ timeout: 30_000 });
  await page.evaluate(() => {
    const at = () => performance.timeOrigin + performance.now();
    const bench: NonNullable<Window["__bench"]> = {};
    window.__bench = bench;
    document.addEventListener("click", () => (bench.tapAt ??= at()), {
      capture: true,
      once: true,
    });
    const observer = new MutationObserver(() => {
      const sent = [...document.querySelectorAll("[role='status'] *")].some(
        (element) => element.textContent?.trim() === "Sent",
      );
      if (!sent || bench.tapAt === undefined) return;
      bench.sentAt = at();
      observer.disconnect();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await button.click();
  await expect(sentStatus(page)).toBeVisible({ timeout: 120_000 });
  const { tapAt, sentAt } = await page.evaluate(() => window.__bench ?? {});
  if (tapAt === undefined || sentAt === undefined)
    throw new Error("tap or Sent not observed");
  return { tapAt, sentAt };
};

const ProofRow = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  mint: Schema.String,
  unit: Schema.String,
  keysetId: Schema.String,
  amount: Schema.Number,
  secret: Schema.String,
  c: Schema.String,
  dleq: Schema.NullOr(Schema.String),
  state: Schema.String,
  operationId: Schema.NullOr(Schema.String),
});
type ProofRow = typeof ProofRow.Type;
type Fixture = Omit<ProofRow, "ownerId" | "state" | "operationId">;

const fixtureOf = (proof: Proof): Fixture => ({
  id: cashuProofIdFor(proof.secret),
  mint: mintUrl,
  unit: "sat",
  keysetId: proof.id,
  amount: proof.amount.toNumber(),
  secret: proof.secret,
  c: proof.C,
  dleq: proof.dleq === undefined ? null : JSON.stringify(proof.dleq),
});

/** Real proofs of the stack's main mint with exactly these amounts. */
const mintProofs = async (amounts: ReadonlyArray<number>) => {
  const wallet = await loadMintWallet(mintUrl);
  const proofs: Fixture[] = [];
  for (let i = 0; i < amounts.length; i += 96) {
    const batch = amounts.slice(i, i + 96);
    const total = batch.reduce((sum, amount) => sum + amount, 0);
    const quote = await wallet.createMintQuoteBolt11(total);
    const data = OutputData.createRandomData(
      total,
      wallet.keyChain.getKeyset(),
      batch,
    );
    const minted = await wallet.mintProofsBolt11(total, quote, undefined, {
      type: "custom",
      data,
    });
    proofs.push(...minted.map(fixtureOf));
  }
  return proofs;
};

const cashuProofs = async (page: Page) =>
  Schema.decodeUnknownSync(Schema.Array(ProofRow))(
    await shardRows(page, "cashu", "cashuProof"),
  );

/**
 * Leaves exactly `wanted` available in the wallet: retires every other
 * available proof (change, the last payment's leftovers) as spent and inserts
 * the missing ones, so each payment starts from the same wallet size.
 */
const setAvailableProofs = async (
  page: Page,
  wanted: ReadonlyArray<Fixture>,
) => {
  const active = Number((await shardIndexes(page)).cashu ?? 0);
  // Registers every cashu shard owner with the hooks' upsert.
  const owners = await Promise.all(
    Array.from({ length: active + 1 }, (_, index) =>
      shardOwnerId(page, "cashu", index),
    ),
  );
  const rows = await cashuProofs(page);
  const available = rows.filter(({ state }) => state === "available");
  const wantedIds = new Set(wanted.map(({ id }) => id));
  const availableIds = new Set(available.map(({ id }) => id));
  const writes = [
    ...available
      .filter(({ id }) => !wantedIds.has(id))
      .map(({ ownerId, ...row }) => ({
        ownerId,
        row: { ...row, state: "spent" },
      })),
    ...wanted
      .filter(({ id }) => !availableIds.has(id))
      .map((row) => ({
        ownerId: owners[active] ?? "",
        row: { ...row, state: "available" },
      })),
  ];
  await Promise.all(
    writes.map(({ ownerId, row }) =>
      upsertRow(
        page,
        "cashuProof",
        // Evolu inserts omit empty optional fields.
        Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)),
        ownerId,
      ),
    ),
  );
  const total = wanted.reduce((sum, { amount }) => sum + amount, 0);
  await page.goto("/#wallet");
  await expect.poll(() => readBalanceSat(page)).toBe(total);
};

const createInvoice = async (amount: number): Promise<string> =>
  (await (await loadMintWallet(targetMintUrl)).createMintQuoteBolt11(amount))
    .request;

const stubClipboard = (page: Page, text: string) =>
  page.evaluate((text) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => text, writeText: async () => {} },
    });
  }, text);

/** Opens the flow up to its last tap and returns that tap's button. */
const openFlow = async (
  page: Page,
  flow: Flow,
  contactId: string,
): Promise<Locator> => {
  const { amount } = FLOWS[flow];
  if (flow === "cashu") {
    await page.goto(`/#contact/${encodeURIComponent(contactId)}/pay`);
    await enterAmount(page, amount);
    return page.locator("[data-guide='pay-send']");
  }
  await stubClipboard(page, await createInvoice(amount));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const paste = page
    .getByRole("dialog", { name: "Send", exact: true })
    .getByRole("button", { name: "Paste", exact: true });
  if (flow === "lightning") return paste;
  await paste.click();
  const dialog = page.getByRole("dialog", { name: "Pay", exact: true });
  await expect(dialog.getByText(/Plus up to/)).toBeVisible({ timeout: 30_000 });
  return dialog.getByRole("button", { name: "Pay", exact: true });
};

interface Sample {
  flow: Flow;
  proofs: number;
  latencyMs: number;
  run: number;
  ms: number;
  mintRequests: number;
  mintMs: number;
  paths: string[];
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};

const samples: Sample[] = [];

for (const proofs of PROOF_COUNTS) {
  test(`payments from ${proofs} proofs`, async ({ bootAccount }) => {
    test.setTimeout(30 * 60_000);
    const { page } = await bootAccount(`payer-${proofs}`);
    const mints = await routeMints(page);
    const contactId = await addContactByNpub(
      page,
      (await createSeedIdentity()).npub,
    );

    // One spend proof per payment and the warm-up. The wallet may pay from filler instead, up to the spend proof's worth.
    const payments = LATENCIES_MS.length * RUNS + 1;
    const spares = FLOW_NAMES.reduce(
      (sum, flow) =>
        sum + payments * Math.ceil(FLOWS[flow].spend / FILLER_SAT + 1),
      0,
    );
    const filler = await mintProofs(
      Array<number>(proofs - 1 + spares).fill(FILLER_SAT),
    );
    const spends = new Map<Flow, Fixture[]>();
    for (const flow of FLOW_NAMES)
      spends.set(
        flow,
        await mintProofs(Array<number>(payments).fill(FLOWS[flow].spend)),
      );

    const spent = new Set<string>();
    const pay = async (flow: Flow, latencyMs: number) => {
      mints.delayMs = 0;
      for (const { id, state } of await cashuProofs(page))
        if (state !== "available") spent.add(id);
      const unspentFiller = filler.filter(({ id }) => !spent.has(id));
      if (unspentFiller.length < proofs - 1)
        throw new Error("ran out of filler proofs");
      const spend = spends.get(flow)?.pop();
      if (spend === undefined) throw new Error("ran out of spend proofs");
      await setAvailableProofs(page, [
        spend,
        ...unspentFiller.slice(0, proofs - 1),
      ]);

      mints.delayMs = latencyMs;
      const button = await openFlow(page, flow, contactId);
      const { tapAt, sentAt } = await timeTap(page, button);
      return {
        flow,
        proofs,
        latencyMs,
        ms: Math.round(sentAt - tapAt),
        ...mintTraffic(mints.requests, tapAt, sentAt),
      };
    };

    // The session's first payment also loads the mint's info, keysets and keys; every timed one starts warm.
    await pay(FLOW_NAMES[0] ?? "cashu", 0);
    if (CPU_THROTTLE > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    }
    for (let run = 0; run < RUNS; run++)
      for (const latencyMs of LATENCIES_MS)
        for (const flow of FLOW_NAMES) {
          const sample = { ...(await pay(flow, latencyMs)), run };
          console.log(JSON.stringify(sample));
          samples.push(sample);
        }
  });
}

test.afterAll(async () => {
  if (samples.length === 0) return;
  const rows = FLOW_NAMES.flatMap((flow) =>
    PROOF_COUNTS.flatMap((proofs) =>
      LATENCIES_MS.flatMap((latencyMs) => {
        const cell = samples.filter(
          (sample) =>
            sample.flow === flow &&
            sample.proofs === proofs &&
            sample.latencyMs === latencyMs,
        );
        if (cell.length === 0) return [];
        return {
          flow,
          proofs,
          latencyMs,
          runs: cell.length,
          ms: median(cell.map(({ ms }) => ms)),
          mintRequests: median(cell.map(({ mintRequests }) => mintRequests)),
          mintMs: median(cell.map(({ mintMs }) => mintMs)),
        };
      }),
    ),
  );
  const table = [
    `${LABEL}: ${process.env.BENCH_BASE_URL ?? "default base URL"}, CPU x${CPU_THROTTLE}, medians`,
    "",
    "| Flow | Proofs | Added latency (ms) | Runs | Tap to Sent (ms) | Mint requests | Time in mint requests (ms) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.flow} | ${row.proofs} | ${row.latencyMs} | ${row.runs} | ${row.ms} | ${row.mintRequests} | ${row.mintMs} |`,
    ),
  ].join("\n");
  console.log(`\n${table}\n`);

  const outDir = path.join(import.meta.dirname, "results");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, `${LABEL}-${new Date().toISOString()}.json`),
    JSON.stringify(
      {
        label: LABEL,
        baseUrl: process.env.BENCH_BASE_URL,
        cpuThrottle: CPU_THROTTLE,
        median: rows,
        samples,
      },
      null,
      2,
    ),
  );
});
