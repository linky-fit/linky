import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { Screen } from "../src/landing/copy";

/** In the order Zapstore shows them. */
const screens: readonly Screen[] = [
  "contacts",
  "chat-payment",
  "chat-request",
  "wallet",
  "proxy-offer",
  "recurring-list",
];

const siteRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

const shots = screens.map((screen, index) => ({
  screen,
  file: `zapstore-screenshots/${String(index + 1).padStart(2, "0")}-${screen}.png`,
}));
const files = shots.map(({ file }) => file);
const zapstoreYaml = await readFile(
  path.resolve(siteRoot, "../../zapstore.yaml"),
  "utf8",
);
const listed = zapstoreYaml.match(/zapstore-screenshots\/[\w-]+\.png/g) ?? [];
if (listed.join() !== files.join())
  throw new Error(`zapstore.yaml images must be: ${files.join(", ")}`);

const server = await createServer({
  root: siteRoot,
  configFile: path.resolve(siteRoot, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch();

try {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing site dev server");
  // Reduced motion makes every demo render its final frame.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await mkdir(path.join(siteRoot, "zapstore-screenshots"), { recursive: true });
  for (const { screen, file } of shots) {
    await page.goto(
      `http://127.0.0.1:${address.port}/store-screen/?screen=${screen}`,
    );
    await page.locator(".demo-screen").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(siteRoot, file) });
    console.log(file);
  }
} finally {
  await browser.close();
  await server.close();
}
