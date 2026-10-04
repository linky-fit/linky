import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { generateSecretKey, nip19 } from "nostr-tools";
import { setBaseStorage, MOBILE_VIEWPORT } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { BOOT_DIAGNOSTIC_TEST_PHRASES } from "../src/utils/bootDiagnosticSecrets.fixture";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { EVOLU_RELAY_URL } from "./helpers/stack";

test.use({ serviceWorkers: "block" });

const MAIN_BUNDLE = /\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?.*)?$/;

test.beforeEach(async ({ page }) => {
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
});

test("recovers once when the main bundle cannot start", async ({ page }) => {
  let mainBundleRequests = 0;

  await page.addInitScript(() => {
    const initializedKey = "linky.test.boot-recovery-initialized";
    if (sessionStorage.getItem(initializedKey) !== "1") {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem(initializedKey, "1");
    }
    Object.defineProperty(window, "__linkyBootWatchdogMs", {
      configurable: true,
      value: 50,
    });
  });
  await page.route(MAIN_BUNDLE, async (route) => {
    mainBundleRequests += 1;
    await route.abort();
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "The app failed to start" }),
  ).toBeVisible({ timeout: 10_000 });
  expect(mainBundleRequests).toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole("button", { name: "Clear cache and reload" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^linky-boot-diagnostics-.*\.json$/,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  if (path === null) return;
  const report: unknown = JSON.parse(await readFile(path, "utf8"));
  expect(report).toMatchObject({
    environment: {
      page: { pathname: "/" },
    },
    shell: {
      watchdogMs: 50,
    },
  });
});

test("does not reload forever when session storage is unavailable", async ({
  page,
}) => {
  let mainBundleRequests = 0;

  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
    Object.defineProperty(window, "__linkyBootWatchdogMs", {
      configurable: true,
      value: 50,
    });
  });
  await page.route(MAIN_BUNDLE, async (route) => {
    mainBundleRequests += 1;
    await route.abort();
  });

  await page.goto("/");

  // The shell renders this panel only on the branch that gives up reloading.
  await expect(
    page.getByRole("heading", { name: "The app failed to start" }),
  ).toBeVisible({ timeout: 10_000 });
  expect(mainBundleRequests).toBe(1);
});

test("recovers when the authenticated app never commits", async ({ page }) => {
  const nsec = nip19.nsecEncode(generateSecretKey());
  const mnemonic = generateMnemonic(wordlist, 128);
  let databaseWorkerRequests = 0;

  await page.addInitScript(
    ([nextNsec, nextMnemonic]) => {
      const initializedKey = "linky.test.commit-recovery-initialized";
      if (sessionStorage.getItem(initializedKey) !== "1") {
        localStorage.clear();
        sessionStorage.clear();
        sessionStorage.setItem(initializedKey, "1");
      }
      localStorage.setItem("linky.lang", "en");
      localStorage.setItem("linky.nostr_nsec", nextNsec);
      localStorage.setItem("linky.initialMnemonic", nextMnemonic);
      Object.defineProperty(window, "__linkyBootWatchdogMs", {
        configurable: true,
        value: 2_000,
      });
    },
    [nsec, mnemonic],
  );
  await page.route("**/*Db.worker*", async (route) => {
    databaseWorkerRequests += 1;
    await route.abort();
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "The app failed to start" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(databaseWorkerRequests).toBeGreaterThanOrEqual(1);
});

test("a SQLite pool lock failure before or after other acquisitions preserves local contacts", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, await createSeedIdentity());
  await page.addInitScript((relay) => {
    localStorage.setItem(
      "linky.evoluServers.disabled.v1",
      JSON.stringify([relay]),
    );
  }, EVOLU_RELAY_URL);
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible();
  await addContactByNpub(page, (await createSeedIdentity()).npub);
  await page.goto("/#contacts");
  await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);

  const recoveries: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("local database failed to open")) {
      recoveries.push(message.text());
    }
  });
  let failureTiming: "before" | "after" | null = null;
  await page.route(/\/assets\/evoluDb\.worker-[^/]+\.js$/, async (route) => {
    if (failureTiming === null) return route.continue();
    const fault = `
      const openHandle = FileSystemFileHandle.prototype.createSyncAccessHandle;
      let failed = false;
      FileSystemFileHandle.prototype.createSyncAccessHandle = async function (...args) {
        if (this.name.startsWith(".")) return openHandle.apply(this, args);
        if (!failed) {
          failed = true;
          if (${failureTiming === "after"}) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new DOMException("Injected pool lock conflict", "NoModificationAllowedError");
        }
        const handle = await openHandle.apply(this, args);
        if (${failureTiming === "before"}) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return handle;
      };
    `;
    failureTiming = null;
    const response = await route.fetch();
    await route.fulfill({ response, body: fault + (await response.text()) });
  });

  // "before" fails while other handles are still being acquired, which then
  // land after the pool gave up; "after" fails once the others are held.
  for (const timing of ["before", "after"] as const) {
    await test.step(`fail ${timing} the other acquisitions`, async () => {
      const recoveriesBefore = recoveries.length;
      failureTiming = timing;
      await page.reload();
      await expect.poll(() => recoveries.length).toBe(recoveriesBefore + 1);
      await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
    });
  }
  await page.reload();
  await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
});

// One test covers both shell branches: an old previous attempt is redacted in
// place, then a current attempt is redacted as it rotates into previous.
test("redacts stored diagnostics before shell recovery and export", async ({
  page,
}) => {
  const nsec = `nsec1${"q".repeat(58)}`;
  const cashu = `cashuA${"a".repeat(40)}`;
  const leakyAttempt = (currentStage: string) => ({
    currentStage,
    events: BOOT_DIAGNOSTIC_TEST_PHRASES.map((phrase) => ({
      error: {
        message: phrase.toUpperCase().replaceAll(" ", "\n\t"),
        name: phrase,
        source: `https://app.linky.fit/${encodeURIComponent(phrase)}`,
        stack: `${nsec} ${cashu}`,
        words: phrase.split(" "),
        quotedWords: JSON.stringify(phrase.split(" ")),
      },
    })),
  });
  await page.addInitScript((previous) => {
    Reflect.set(window, "__linkyBootWatchdogMs", 50);
    if (sessionStorage.getItem("linky.test.diagnostics-seeded") !== null)
      return;
    sessionStorage.clear();
    sessionStorage.setItem("linky.test.diagnostics-seeded", "1");
    sessionStorage.setItem(
      "linky.boot.shell_recovery_at.v1",
      String(Date.now()),
    );
    sessionStorage.setItem(
      "linky.boot.diagnostics.previous.v1",
      JSON.stringify(previous),
    );
  }, leakyAttempt("import-evolu"));
  await page.route(MAIN_BUNDLE, (route) => route.abort());
  const expectRedacted = (text: string) => {
    expect(text).toContain("[redacted recovery phrase]");
    expect(text.toLowerCase()).not.toContain("lilac");
    expect(text.toLowerCase()).not.toContain("abandon");
    expect(text).not.toContain(nsec);
    expect(text).not.toContain(cashu);
  };
  const storedDiagnostics = () =>
    page.evaluate(() => JSON.stringify(sessionStorage));
  const downloadButton = page.getByRole("button", {
    name: "Download diagnostics",
  });

  await page.goto("/");
  await expect(downloadButton).toBeVisible();
  const storedPrevious = await storedDiagnostics();
  expect(storedPrevious).toContain("import-evolu");
  expectRedacted(storedPrevious);

  await page.evaluate(
    (current) =>
      sessionStorage.setItem(
        "linky.boot.diagnostics.current.v1",
        JSON.stringify(current),
      ),
    leakyAttempt("import-app"),
  );
  await page.reload();
  await expect(downloadButton).toBeVisible();
  const storedRotated = await storedDiagnostics();
  expect(storedRotated).toContain("import-app");
  expectRedacted(storedRotated);

  await page.evaluate((phrases) => {
    sessionStorage.setItem(
      "linky.boot.diagnostics.current.v1",
      JSON.stringify({
        currentStage: "render-failed",
        message: phrases[0],
        words: phrases[1]?.split(" "),
      }),
    );
    history.replaceState(null, "", `/${encodeURIComponent(phrases[0] ?? "")}`);
  }, BOOT_DIAGNOSTIC_TEST_PHRASES);
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const downloadPath = await (await downloadPromise).path();
  if (!downloadPath) throw new Error("Missing diagnostic download");
  const report = await readFile(downloadPath, "utf8");
  expect(report).toContain("import-app");
  expect(report).toContain("render-failed");
  expectRedacted(report);
});
