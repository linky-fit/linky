import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { Schema } from "effect";
import { readBalanceSat, relaunchApp } from "../tests/helpers/appState";
import { addContactByNpub } from "../tests/helpers/contacts";
import { shardRows } from "../tests/helpers/linkyHooks";
import { enterAmount, test } from "../tests/helpers/recurringPayments";
import { topUp } from "../tests/helpers/wallet";

const numberEnv = (name: string, fallback: number): number =>
  Number(process.env[name] ?? fallback);

/** Past sends seeded before timing; each leaves an operation and five spent proofs. 0 times a fresh wallet. */
const HISTORY_SENDS = numberEnv("BENCH_HISTORY_SENDS", 300);
const RUNS = numberEnv("BENCH_RUNS", 5);
/** Chromium CPU slowdown factor; 4–6 is roughly a mid-range phone. */
const CPU_THROTTLE = numberEnv("BENCH_CPU_THROTTLE", 1);
const LABEL = process.env.BENCH_LABEL ?? "run";
const TOP_UP_SAT = 5_000;
const SEND_SAT = 21;

const PayStep = Schema.Struct({
  at: Schema.Number,
  tag: Schema.String,
  payload: Schema.Struct({ step: Schema.optional(Schema.String) }),
});
const InspectorPage = Schema.Struct({
  rows: Schema.Array(PayStep),
  cursor: Schema.Number,
});

/** `pay.step` times, in ms after the payment's `start`, from the dev server's inspector collector. */
const payStepsSince = async (
  page: Page,
  sinceMs: number,
): Promise<Record<string, number>> => {
  const steps: Record<string, number> = {};
  let startAt: number | null = null;
  for (let cursor = 0; ; ) {
    const response = await page.request.get(
      `/__inspector/events?channel=app.log&cursor=${cursor}`,
    );
    const { rows, cursor: next } = Schema.decodeUnknownSync(InspectorPage)(
      await response.json(),
    );
    for (const { at, tag, payload } of rows) {
      if (tag !== "pay.step" || at < sinceMs || payload.step === undefined)
        continue;
      startAt ??= at;
      steps[payload.step] ??= at - startAt;
    }
    if (next === cursor) return steps;
    cursor = next;
  }
};

const timeOneSend = async (page: Page, contactId: string) => {
  await page.goto(`/#contact/${encodeURIComponent(contactId)}/pay`);
  await enterAmount(page, SEND_SAT);
  const sent = page.getByRole("status").getByText("Sent", { exact: true });
  const tapAt = Date.now();
  await page.locator("[data-guide='pay-send']").click();
  await expect(sent).toBeVisible({ timeout: 120_000 });
  const tapToSentMs = Date.now() - tapAt;
  await expect(sent).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(async () => (await payStepsSince(page, tapAt))["message-ack"], {
      timeout: 30_000,
    })
    .toBeDefined();
  return { tapToSentMs, ...(await payStepsSince(page, tapAt)) };
};

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};

test("send to a contact from a long-lived wallet", async ({ bootAccount }) => {
  const sender = await bootAccount("sender");
  const recipient = await bootAccount("recipient");
  const { page } = sender;

  await topUp(page, TOP_UP_SAT);
  await expect.poll(() => readBalanceSat(page)).toBe(TOP_UP_SAT);
  const contactId = await addContactByNpub(page, recipient.identity.npub);

  const [funded] = await shardRows(page, "cashu", "cashuProof");
  const shardIndex = await page.evaluate(
    (history) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.seedCashuHistory(history);
    },
    {
      mint: String(funded?.mint),
      keysetId: String(funded?.keysetId),
      sends: HISTORY_SENDS,
    },
  );
  // A cold boot over the seeded history, as the app starts on a phone.
  await relaunchApp(page, "/#wallet", async () => {});
  const proofRows = (await shardRows(page, "cashu", "cashuProof")).length;

  if (CPU_THROTTLE > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  }

  const runs = [];
  for (let run = 0; run < RUNS; run++)
    runs.push(await timeOneSend(page, contactId));

  const columns = [
    "tapToSentMs",
    "swap-ok",
    "publish-ok",
    "payment-notice-publish",
  ] as const;
  const summary = Object.fromEntries(
    columns.map((column) => [
      column,
      median(runs.map((run) => run[column] ?? NaN)),
    ]),
  );
  console.log(
    `\n[${LABEL}] ${HISTORY_SENDS} past sends, ${proofRows} proof rows, cashu shard ${shardIndex}, CPU x${CPU_THROTTLE}`,
  );
  console.table(runs);
  console.log("median", summary);

  const outDir = path.join(import.meta.dirname, "results");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, `${LABEL}-${new Date().toISOString()}.json`),
    JSON.stringify(
      {
        label: LABEL,
        historySends: HISTORY_SENDS,
        proofRows,
        shardIndex,
        cpuThrottle: CPU_THROTTLE,
        runs,
        median: summary,
      },
      null,
      2,
    ),
  );
});
