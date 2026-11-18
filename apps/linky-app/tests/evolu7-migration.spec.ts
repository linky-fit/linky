// Moving to Evolu 8 must keep what the Evolu 7 release stored on a device.
// Each test runs the Evolu 7 build, then this build on the same origin and
// browser profile. It needs that build's files, made with the stack's
// endpoints, in LINKY_E2E_EVOLU7_DIST; the Evolu 8 release notes in
// docs/releases.md say how to build them. Without it the tests skip.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateSecretKey, nip19 } from "nostr-tools";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
} from "./helpers/appState";
import { EVOLU_WORKER_BUNDLE } from "./helpers/bundles";
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { EVOLU_RELAY_URL } from "./helpers/stack";
import { topUp } from "./helpers/wallet";

const evolu7Dist = process.env.LINKY_E2E_EVOLU7_DIST;

test.skip(!evolu7Dist, "LINKY_E2E_EVOLU7_DIST names no Evolu 7 build");
test.use({
  serviceWorkers: "block",
  viewport: MOBILE_VIEWPORT,
  // Chrome treats a document Playwright serves as public and would refuse its requests to the stack on localhost.
  launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
});

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves the page the Evolu 7 build in place of this one until the returned function stops it. */
const serveEvolu7Build = async (
  page: Page,
  origin: string,
): Promise<() => Promise<void>> => {
  const dist = evolu7Dist ?? "";
  const matcher = (url: URL) => url.origin === origin;
  await page.route(matcher, async (route) => {
    const { pathname } = new URL(route.request().url());
    const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
    const body = await readFile(file).catch(() =>
      readFile(path.join(dist, "index.html")),
    );
    await route.fulfill({
      body,
      contentType: contentTypes[path.extname(file)] ?? "text/html",
    });
  });
  return () => page.unroute(matcher);
};

/** The OPFS directories of Evolu 7 databases, `.linky-<hash>` and `.linky-anon`. */
const evolu7Directories = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    // @ts-expect-error OPFS FileSystemDirectoryHandle.keys() is not in TS's DOM lib yet
    for await (const name of root.keys()) names.push(name);
    return names.filter((name) => /^\.linky-(?:[0-9a-f]{8}|anon)$/.test(name));
  });

const openDevice = async (
  context: BrowserContext,
  label: string,
  storage: (page: Page) => Promise<void>,
  { relay = false }: { readonly relay?: boolean } = {},
) => {
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await storage(page);
  // Without the relay only the move can bring the data into Evolu 8.
  if (!relay)
    await page.addInitScript((url) => {
      localStorage.setItem(
        "linky.evoluServers.disabled.v1",
        JSON.stringify([url]),
      );
    }, EVOLU_RELAY_URL);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  return { page, errors };
};

/** This build logs how it opened Evolu; the Evolu 7 build does not. */
const expectThisBuild = (page: Page) =>
  page.waitForEvent("console", (message) =>
    message.text().startsWith("[linky][boot] evolu opened"),
  );

const expectMigrated = async (page: Page, label: string) => {
  await expect.poll(() => evolu7Directories(page)).toEqual([]);
  await expectNoBootErrorPanel(page, label);
  await expect(
    page.getByRole("heading", { name: "The app failed to start" }),
  ).toHaveCount(0);
};

test("an account's contacts, messages and wallet move from Evolu 7", async ({
  browser,
}, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? "").origin;
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const identity = await createSeedIdentity();
    const { page, errors } = await openDevice(context, "seed login", (page) =>
      setSeedLoginStorage(page, identity),
    );
    const stopEvolu7 = await serveEvolu7Build(page, origin);
    const message = "Written by Evolu 7";

    await test.step("the Evolu 7 build stores a contact, a message and ecash", async () => {
      await page.goto("/#wallet");
      await expect(page.getByLabel("Available balance")).toBeVisible();
      await topUp(page, 210);
      await expect.poll(() => readBalanceSat(page)).toBe(210);
      await addContactByNpub(page, (await createSeedIdentity()).npub);
      await page.locator('[data-guide="chat-input"]').fill(message);
      await page.locator('[data-guide="chat-send"]').click();
      await expect(
        page.getByTestId("chat-bubble").filter({ hasText: message }),
      ).toBeVisible();
      expect(await evolu7Directories(page)).toHaveLength(1);
    });

    await test.step("while a tab runs the Evolu 7 build, this build asks to close it", async () => {
      const other = await context.newPage();
      await other.goto("/#wallet");
      await expect(
        other.getByRole("heading", { name: "Linky is open in another tab" }),
      ).toBeVisible();
      await testInfo.attach("another tab holds the database", {
        body: await other.screenshot(),
        contentType: "image/png",
      });
      await other.close();
    });

    await test.step("this build moves them into Evolu 8 and deletes the Evolu 7 database", async () => {
      await stopEvolu7();
      // Holds the database worker, so the notice stays up long enough to see.
      let releaseWorker = () => {};
      await page.route(EVOLU_WORKER_BUNDLE, async (route) => {
        await new Promise<void>((resolve) => (releaseWorker = resolve));
        await route.continue();
      });
      const opened = expectThisBuild(page);
      // A new hash alone would keep the Evolu 7 document.
      await page.reload();
      await expect(
        page.getByRole("status").filter({ hasText: "Moving your data" }),
      ).toBeVisible();
      await testInfo.attach("moving the data", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      releaseWorker();
      await opened;
      await page.unroute(EVOLU_WORKER_BUNDLE);
      await page.goto("/#contacts");
      await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
      await page.locator('[data-guide="contact-card"]').click();
      await expect(
        page.getByTestId("chat-bubble").filter({ hasText: message }),
      ).toBeVisible();
      await page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(page)).toBe(210);
      await expectMigrated(page, "seed login");
      await page.reload();
      await expect.poll(() => readBalanceSat(page)).toBe(210);
      errors.assertClean();
    });
  } finally {
    await context.close();
  }
});

test("a session without an app mnemonic keeps the owner Evolu 7 created", async ({
  browser,
}, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? "").origin;
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const nsec = nip19.nsecEncode(generateSecretKey());
    const { page, errors } = await openDevice(context, "anon", (page) =>
      page.addInitScript((nextNsec) => {
        localStorage.setItem("linky.nostr_nsec", nextNsec);
      }, nsec),
    );
    const stopEvolu7 = await serveEvolu7Build(page, origin);

    await test.step("the Evolu 7 build stores a contact in linky-anon", async () => {
      await page.goto("/#contacts");
      await addContactByNpub(page, (await createSeedIdentity()).npub);
      expect(await evolu7Directories(page)).toEqual([".linky-anon"]);
    });

    await test.step("this build opens that owner with the contact", async () => {
      await stopEvolu7();
      const opened = expectThisBuild(page);
      // A new hash alone would keep the Evolu 7 document.
      await page.reload();
      await opened;
      await page.goto("/#contacts");
      await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
      await expectMigrated(page, "anon");
      await page.reload();
      await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
      errors.assertClean();
    });
  } finally {
    await context.close();
  }
});

test("an Evolu 7 device and an Evolu 8 device of one account sync through the relay", async ({
  browser,
}, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? "").origin;
  const identity = await createSeedIdentity();
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ baseURL: testInfo.project.use.baseURL }),
    ),
  );
  try {
    const [old, current] = await Promise.all(
      contexts.map((context, index) =>
        openDevice(
          context,
          index === 0 ? "Evolu 7" : "Evolu 8",
          (page) => setSeedLoginStorage(page, identity),
          { relay: true },
        ),
      ),
    );
    await serveEvolu7Build(old.page, origin);
    const contacts = (page: Page) =>
      page.locator('[data-guide="contact-card"]');

    await test.step("a contact the Evolu 7 device adds reaches the Evolu 8 device", async () => {
      await old.page.goto("/#contacts");
      await addContactByNpub(old.page, (await createSeedIdentity()).npub);
      await current.page.goto("/#contacts");
      await expect(contacts(current.page)).toHaveCount(1);
    });

    await test.step("a contact the Evolu 8 device adds reaches the Evolu 7 device", async () => {
      await addContactByNpub(current.page, (await createSeedIdentity()).npub);
      await old.page.goto("/#contacts");
      await expect(contacts(old.page)).toHaveCount(2);
      current.errors.assertClean();
    });
  } finally {
    for (const context of contexts) await context.close();
  }
});
