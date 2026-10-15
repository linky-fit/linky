import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  setBaseStorage,
} from "../../web-app/tests/helpers/appState";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "../../web-app/tests/helpers/identity";

const DEMO_PATH = "/demo/auth/";
const LOG_IN = { name: "Log in" };

/** A fresh Linky tab with the identity signed in, opened straight on `url`. */
const openLinky = async (
  context: BrowserContext,
  identity: SeedIdentity,
  url: string,
): Promise<Page> => {
  const page = await context.newPage();
  await page.setViewportSize(MOBILE_VIEWPORT);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await page.goto(url);
  return page;
};

const hrefOf = async (page: Page, testId: string): Promise<string> => {
  const href = await page.getByTestId(testId).getAttribute("href");
  if (href === null) throw new Error(`${testId} has no href`);
  return href;
};

const openDemo = async (context: BrowserContext): Promise<Page> => {
  const demo = await context.newPage();
  await demo.goto(DEMO_PATH);
  return demo;
};

const linkyOriginOf = async (demo: Page): Promise<string> =>
  new URL(await hrefOf(demo, "demo-auth-open-linky")).origin;

test("a same-device login returns to the demo after its tab went away, and survives a denial", async ({
  context,
}) => {
  const identity = await createSeedIdentity();
  const demo = await openDemo(context);
  const audience = new URL(demo.url()).origin;
  const openUrl = await hrefOf(demo, "demo-auth-open-linky");
  await demo.close();

  const denied = await openLinky(context, identity, openUrl);
  const dialog = denied.getByRole("dialog", { name: audience });
  await expect(dialog.getByText("Verified", { exact: true })).toBeVisible();
  await denied.getByRole("button", { name: "Cancel" }).click();
  await expect(denied.getByTestId("demo-auth-denied")).toBeVisible();

  await denied.getByTestId("demo-auth-retry").click();
  const retryUrl = await hrefOf(denied, "demo-auth-open-linky");
  await denied.close();
  const approved = await openLinky(context, identity, retryUrl);
  await approved.getByRole("button", LOG_IN).click();
  await expect(approved.getByTestId("demo-auth-npub")).toHaveText(
    identity.npub,
  );
});

test("a same-device login finished in another tab does not fail the tab that started it", async ({
  context,
}) => {
  const identity = await createSeedIdentity();
  const demo = await openDemo(context);

  const linky = await openLinky(
    context,
    identity,
    await hrefOf(demo, "demo-auth-open-linky"),
  );
  await linky.getByRole("button", LOG_IN).click();

  await expect(linky.getByTestId("demo-auth-npub")).toHaveText(identity.npub);
  await expect(demo.getByTestId("demo-auth-npub")).toHaveText(identity.npub);
});

test("a QR login approved in Linky reaches the demo tab, and a denial sends nothing", async ({
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const identity = await createSeedIdentity();
  const demo = await openDemo(context);
  await demo.getByTestId("demo-auth-copy-link").click();
  const qrLink = await demo.evaluate(() => navigator.clipboard.readText());
  expect(qrLink).toContain("#linkauth?");
  expect(qrLink).not.toContain("cb=");

  const denied = await openLinky(context, identity, qrLink);
  await denied.getByRole("button", { name: "Cancel" }).click();
  await expect(denied.getByRole("dialog")).toBeHidden();
  await expect(demo.getByTestId("demo-auth-qr")).toBeVisible();

  const approved = await openLinky(context, identity, qrLink);
  await approved.getByRole("button", LOG_IN).click();
  await expect(demo.getByTestId("demo-auth-npub")).toHaveText(identity.npub);
});

test("Linky refuses a login it cannot verify and offers no way to approve", async ({
  context,
}) => {
  const identity = await createSeedIdentity();
  const demo = await openDemo(context);
  const linkyOrigin = await linkyOriginOf(demo);
  const demoOrigin = new URL(demo.url()).origin;
  const nonce = "A".repeat(43);
  const linkTo = (origin: string, callback = "") =>
    `${linkyOrigin}/#linkauth?o=${encodeURIComponent(origin)}&n=${nonce}${callback && `&cb=${encodeURIComponent(callback)}`}`;
  const refused = [
    // The web app publishes no domain document.
    linkTo(linkyOrigin),
    linkTo(demoOrigin, `${demoOrigin}/elsewhere/`),
  ];

  for (const link of refused) {
    const linky = await openLinky(context, identity, link);
    await expect(linky.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(linky.getByRole("button", LOG_IN)).toHaveCount(0);
    await linky.close();
  }
});

test("Linky refuses a NIP-46 login to the demo, which publishes a domain document", async ({
  context,
}) => {
  const identity = await createSeedIdentity();
  const demo = await openDemo(context);
  const linkyOrigin = await linkyOriginOf(demo);
  await expect(demo.getByTestId("demo-auth-uri-link")).toHaveCount(0);
  await demo.getByTestId("demo-auth-other-signer").click();
  const uri = await hrefOf(demo, "demo-auth-uri-link");

  const linky = await openLinky(context, identity, `${linkyOrigin}/#${uri}`);
  await expect(
    linky.getByText(/supports logging in with Linky/u).first(),
  ).toBeVisible();
  await expect(linky.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(linky.getByRole("button", LOG_IN)).toHaveCount(0);
});
