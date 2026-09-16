import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { generateSecretKey, nip19 } from "nostr-tools";
import { setBaseStorage, MOBILE_VIEWPORT } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { BOOT_DIAGNOSTIC_TEST_PHRASES } from "../src/utils/bootDiagnosticSecrets.fixture";
import { watchAppErrors } from "./helpers/diagnostics";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

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

  await expect(
    page.getByRole("heading", { name: "The app failed to start" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(250);
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

for (const channelState of ["missing", "blocked"]) {
  test(`boots and persists contacts with ${channelState} BroadcastChannel and no Web Locks`, async ({
    page,
  }) => {
    const errors = watchAppErrors(page, `compat ${channelState}`);
    await page.setViewportSize(MOBILE_VIEWPORT);
    page.setDefaultTimeout(20_000);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, await createSeedIdentity());
    await page.addInitScript((state) => {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "BroadcastChannel", {
        configurable: true,
        writable: true,
        value:
          state === "missing"
            ? undefined
            : class {
                constructor() {
                  throw new DOMException("Blocked", "SecurityError");
                }
              },
      });
    }, channelState);
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    const contact = await createSeedIdentity();
    const id = await addContactByNpub(page, contact.npub);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#chat/${id}$`));
    await expect(page.locator('[data-guide="chat-input"]')).toBeVisible();
    await page.goto("/#contacts");
    await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
    errors.assertClean();
  });
}

for (const attempt of ["current", "previous"]) {
  test(`redacts ${attempt} stored diagnostics before shell recovery and export`, async ({
    page,
  }) => {
    const nsec = `nsec1${"q".repeat(58)}`;
    const cashu = `cashuA${"a".repeat(40)}`;
    await page.addInitScript(
      ({ attempt, phrases, nsec, cashu }) => {
        sessionStorage.clear();
        sessionStorage.setItem(
          "linky.boot.shell_recovery_at.v1",
          String(Date.now()),
        );
        sessionStorage.setItem(
          `linky.boot.diagnostics.${attempt}.v1`,
          JSON.stringify({
            currentStage: "import-app",
            events: phrases.map((phrase) => ({
              error: {
                message: phrase.toUpperCase().replaceAll(" ", "\n\t"),
                name: phrase,
                source: `https://app.linky.fit/${encodeURIComponent(phrase)}`,
                stack: `${nsec} ${cashu}`,
                words: phrase.split(" "),
                quotedWords: JSON.stringify(phrase.split(" ")),
              },
            })),
          }),
        );
        Reflect.set(window, "__linkyBootWatchdogMs", 50);
      },
      { attempt, phrases: BOOT_DIAGNOSTIC_TEST_PHRASES, nsec, cashu },
    );
    await page.route(MAIN_BUNDLE, (route) => route.abort());
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Download diagnostics" }),
    ).toBeVisible();

    const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(stored).toContain("[redacted recovery phrase]");
    expect(stored.toLowerCase()).not.toContain("lilac");
    expect(stored.toLowerCase()).not.toContain("abandon");
    expect(stored).not.toContain(nsec);
    expect(stored).not.toContain(cashu);

    await page.evaluate((phrases) => {
      sessionStorage.setItem(
        "linky.boot.diagnostics.current.v1",
        JSON.stringify({
          currentStage: "render-failed",
          message: phrases[0],
          words: phrases[1]?.split(" "),
        }),
      );
      history.replaceState(
        null,
        "",
        `/${encodeURIComponent(phrases[0] ?? "")}`,
      );
    }, BOOT_DIAGNOSTIC_TEST_PHRASES);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download diagnostics" }).click();
    const downloadPath = await (await downloadPromise).path();
    if (!downloadPath) throw new Error("Missing diagnostic download");
    const report = await readFile(downloadPath, "utf8");
    expect(report).toContain("import-app");
    expect(report).toContain("render-failed");
    expect(report).toContain("[redacted recovery phrase]");
    expect(report.toLowerCase()).not.toContain("lilac");
    expect(report.toLowerCase()).not.toContain("abandon");
    expect(report).not.toContain(nsec);
    expect(report).not.toContain(cashu);
  });
}
