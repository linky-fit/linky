import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createSlip39Share } from "@linky/identity";
import { Effect, Schema } from "effect";
import { generateSecretKey, type Event } from "nostr-tools";
import { wrapEvent } from "nostr-tools/nip59";
import { createServer } from "vite";
import { loginWithSecret } from "../src/auth";

const seed = await Effect.runPromise(createSlip39Share());
const session = await loginWithSecret(seed);
const sender = generateSecretKey();
const events: Event[] = [];
const addReport = (id: string, createdAtSec: number) => {
  events.push(
    wrapEvent(
      {
        kind: 24134,
        tags: [["p", session.pubkey]],
        content: JSON.stringify({
          v: 1,
          id,
          createdAtSec,
          direction: "out",
          status: "error",
          method: "cashu_chat",
          phase: "swap",
          errorCode: "mint_failed",
          errorDetail: "Synthetic mint regression",
          appVersion: "26.9.7",
          devicePlatform: "android",
          appRuntime: "native",
          appHost: "app.linky.fit",
        }),
      },
      sender,
      session.pubkey,
    ),
  );
};
addReport("original", Math.floor(Date.now() / 1000) - 60);
const Request = Schema.parseJson(
  Schema.Tuple(
    Schema.Literal("REQ"),
    Schema.String,
    Schema.Struct({
      kinds: Schema.Array(Schema.Number),
      until: Schema.optional(Schema.Number),
      limit: Schema.optional(Schema.Number),
    }),
  ),
);
let publishes = 0;
const errors: string[] = [];
const installInbox = async (context: BrowserContext) => {
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });
  await context.routeWebSocket(/^wss:\/\//, (socket) => {
    socket.onMessage((raw) => {
      const text = raw.toString();
      if (text.startsWith('["EVENT"')) publishes++;
      const decoded = Schema.decodeUnknownOption(Request)(text);
      if (decoded._tag === "None") return;
      const [, id, filter] = decoded.value;
      for (const event of events
        .filter(
          (event) =>
            filter.kinds.includes(event.kind) &&
            (filter.until === undefined || event.created_at <= filter.until),
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, filter.limit)) {
        socket.send(JSON.stringify(["EVENT", id, event]));
      }
      socket.send(JSON.stringify(["EOSE", id]));
    });
  });
};
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  define: {
    "import.meta.env.VITE_EVOLU_SERVER_URLS": JSON.stringify(
      "ws://127.0.0.1:4001",
    ),
  },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === "string")
  throw new Error("Missing local test server");
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
const signIn = async (page: Page, query = "") => {
  await page.goto(`${url}${query}`);
  await page.getByLabel("Linky recovery phrase", { exact: true }).fill(seed);
  await expect(page.getByText("Connect Nostr extension")).toHaveCount(0);
  await page.getByRole("button", { name: "Open error inbox" }).click();
  await expect(page.getByRole("button", { name: "Refresh inbox" })).toBeVisible(
    { timeout: 30_000 },
  );
};

try {
  const first = await browser.newContext();
  await installInbox(first);
  const page = await first.newPage();
  await signIn(page, "/?version=26.9.7&period=7&platform=android");
  await expect(page.locator(".issue-row")).toHaveCount(1);
  await expect(
    page.getByLabel("Version 26.9.7", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Platform", { exact: true })).toHaveValue(
    "android",
  );
  await page.getByLabel("Time period").selectOption("custom");
  await page.getByLabel("From date").fill("2026-01-01");
  assert.equal(new URL(page.url()).searchParams.get("from"), "2026-01-01");
  await page.getByLabel("Time period").selectOption("7");
  await page.goBack();
  await expect(page.getByLabel("Time period")).toHaveValue("custom");
  await expect(page.getByLabel("From date")).toHaveValue("2026-01-01");
  await page.goForward();
  await expect(page.getByLabel("Time period")).toHaveValue("7");
  const preset = new URL(page.url()).search;
  await page.reload();
  await expect(page.getByLabel("Time period")).toHaveValue("7");
  await expect(
    page.getByLabel("Version 26.9.7", { exact: true }),
  ).toBeChecked();
  await expect(page.locator(".issue-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Mark as solved" }).click();
  await expect(page.locator(".issue-row")).toHaveCount(0);
  await page.getByLabel("Show solved issues").check();
  await expect(page.locator(".issue-row .issue-status")).toHaveText("solved");
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh inbox" })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(page.getByLabel("Show solved issues")).toBeChecked();
  await expect(page.locator(".issue-row .issue-status")).toHaveText("solved");

  const second = await browser.newContext();
  await installInbox(second);
  const other = await second.newPage();
  await signIn(other, `/${preset}`);
  await expect(other.getByLabel("Time period")).toHaveValue("7");
  await expect(other.getByLabel("Platform", { exact: true })).toHaveValue(
    "android",
  );
  await other.getByLabel("Show solved issues").check();
  await expect(other.locator(".issue-row .issue-status")).toHaveText("solved", {
    timeout: 30_000,
  });
  await other.getByLabel("Show solved issues").uncheck();

  // Wait for the next timestamp second so the report is unambiguously later.
  const recurrenceAt = Math.floor(Date.now() / 1000) + 1;
  await expect
    .poll(() => Math.floor(Date.now() / 1000))
    .toBeGreaterThanOrEqual(recurrenceAt);
  addReport("recurrence", recurrenceAt);
  await other.getByRole("button", { name: "Refresh inbox" }).click();
  await expect(other.locator(".issue-row .issue-status")).toHaveText(
    "reoccurred",
  );
  await other.reload();
  await expect(other.locator(".issue-row .issue-status")).toHaveText(
    "reoccurred",
    { timeout: 30_000 },
  );
  await other.screenshot({
    path: fileURLToPath(
      new URL("../test-results/reoccurred.png", import.meta.url),
    ),
    fullPage: true,
  });
  await other.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await other.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await other.screenshot({
    path: fileURLToPath(
      new URL("../test-results/reoccurred-mobile.png", import.meta.url),
    ),
    fullPage: true,
  });
  await other.getByRole("button", { name: "Mark as solved" }).click();
  await expect(other.locator(".issue-row")).toHaveCount(0);

  await page.getByLabel("Show solved issues").uncheck();
  await page.getByRole("button", { name: "Refresh inbox" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }),
  ).toBeVisible();
  await expect(page.locator(".issue-row")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#secret")).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("linky.errorTracker.seed")),
    null,
  );
  await page.reload();
  await expect(page.locator("#secret")).toBeVisible();
  assert.equal(publishes, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Workspace passed: filter presets, URL updates, Back/Forward, seed reload, solve/hide/show, cross-device Evolu sync, recurrence, solve again, sign-out, zero console errors or Nostr publications.",
  );
} finally {
  await browser.close();
  await server.close();
  session.dispose();
  sender.fill(0);
}
