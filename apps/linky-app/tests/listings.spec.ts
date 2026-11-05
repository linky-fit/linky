/**
 * Listings — two real app instances that saved each other.
 *
 * A adds a listing with a photo and says they offer cash; both reach B through
 * A's kind 34133 event on the relay, decrypted through B's key slot, and B's
 * detail page decrypts the photo from the stubbed Blossom server. B's own page
 * stays empty until then, which proves the content came from the relay.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { createHash } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

interface Account {
  context: BrowserContext;
  errors: ReturnType<typeof watchAppErrors>;
  identity: SeedIdentity;
  label: string;
  page: Page;
}

/** Encrypted uploads by url, served back to either browser. */
const blobs = new Map<string, Buffer>();

const stubBlossom = (page: Page) =>
  page.route("https://blossom.primal.net/**", async (route) => {
    const request = route.request();
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (request.method() === "PUT") {
      const body = request.postDataBuffer();
      if (!body) throw new Error("Empty upload");
      const sha256 = createHash("sha256").update(body).digest("hex");
      const url = `https://blossom.primal.net/${sha256}`;
      blobs.set(url, body);
      await route.fulfill({ headers, json: { url, sha256 } });
      return;
    }
    const body = blobs.get(request.url());
    if (!body) return route.fallback();
    await route.fulfill({ headers, body, contentType: "text/plain" });
  });

const bootAccount = async (
  browser: Browser,
  label: string,
): Promise<Account> => {
  const identity = await createSeedIdentity();
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await stubBlossom(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await expectNoBootErrorPanel(page, label);
  await expectSingleLoad(page, label);
  return { context, errors, identity, label, page };
};

test("a listing and the cash intent reach a contact who saved the author back", async ({
  browser,
}) => {
  const a = await bootAccount(browser, "A");
  const b = await bootAccount(browser, "B");

  try {
    await test.step("A and B save each other", async () => {
      await addContactByNpub(a.page, b.identity.npub);
      await addContactByNpub(b.page, a.identity.npub);
    });

    await test.step("B has nothing from contacts yet", async () => {
      await b.page.goto("/#collaboration/listings");
      await expect(b.page.getByTestId("peer-listing")).toHaveCount(0);
    });

    await test.step("A adds a listing with a photo, priced in the display unit", async () => {
      await a.page.goto("/#collaboration/listings/new");
      await a.page.getByTestId("listing-title").fill("Eggs from the garden");
      await a.page.getByTestId("listing-amount").fill("90");
      await a.page.getByTestId("listing-unit").fill("per 10 pieces");
      const png = await a.page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 48;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No canvas context");
        context.fillStyle = "#e0a030";
        context.fillRect(0, 0, 64, 48);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const fileChooser = a.page.waitForEvent("filechooser");
      await a.page.getByTestId("listing-image-add").click();
      await (
        await fileChooser
      ).setFiles({
        name: "eggs.png",
        mimeType: "image/png",
        buffer: Buffer.from(png ?? "", "base64"),
      });
      await expect(
        a.page.getByTestId("listing-image").locator("img"),
      ).toBeVisible();
      await a.page.getByTestId("listing-save").click();
      await a.page.waitForURL(/#collaboration\/listings$/);
      const own = a.page.getByTestId("own-listing");
      await expect(own).toHaveCount(1);
      await expect(own).toContainText("Eggs from the garden");
      await expect(own).toContainText("90 sat");
    });

    await test.step("A offers cash", async () => {
      await a.page.goto("/#collaboration/cash");
      await a.page.getByRole("radio", { name: "I have cash" }).click();
      await expect(
        a.page.getByRole("radio", { name: "I have cash" }),
      ).toHaveAttribute("aria-checked", "true");
    });

    await test.step("B sees A's listing and cash intent", async () => {
      await b.page.goto("/#collaboration/listings");
      const peer = b.page.getByTestId("peer-listing");
      await expect(peer).toHaveCount(1, { timeout: 60_000 });
      await expect(peer).toContainText("Eggs from the garden");
      await expect(peer).toContainText("per 10 pieces");
      await expect(peer).toContainText("90 sat");

      await peer.click();
      await expect(
        b.page.getByRole("img", { name: "Eggs from the garden" }),
      ).toBeVisible();
      await expect(b.page.getByTestId("listing-reply")).toBeVisible();

      await b.page.goto("/#collaboration/cash");
      await expect(
        b.page.getByRole("heading", { name: "Offer cash" }).locator(".."),
      ).not.toContainText("None of your contacts yet", { timeout: 60_000 });

      await b.page.goto("/#collaboration");
      await expect(b.page.getByTestId("open-listings")).toContainText(
        "1 listing",
      );
      await expect(b.page.getByTestId("open-cash")).toContainText(
        "1 contact exchanges",
      );
    });

    await test.step("A withdraws the listing and B stops seeing it", async () => {
      await a.page.goto("/#collaboration/listings");
      await a.page.getByTestId("own-listing").click();
      await a.page.getByTestId("listing-edit").click();
      await a.page.waitForURL(/#collaboration\/listings\/[^/]+$/);
      await a.page.getByRole("button", { name: "Remove listing" }).click();
      await a.page.waitForURL(/#collaboration\/listings$/);
      await expect(a.page.getByTestId("own-listing")).toHaveCount(0);

      await b.page.goto("/#collaboration/listings");
      await expect(b.page.getByTestId("peer-listing")).toHaveCount(0, {
        timeout: 60_000,
      });
    });

    for (const account of [a, b]) account.errors.assertClean();
  } finally {
    await Promise.all([a.context.close(), b.context.close()]);
  }
});
