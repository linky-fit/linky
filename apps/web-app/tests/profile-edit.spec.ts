import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { Schema } from "effect";
import {
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
} from "nostr-tools";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { waitForProfileStatusOnRelay } from "./helpers/relay";
import { NOSTR_RELAY_URL } from "./helpers/stack";
import { nowSeconds } from "../src/utils/time";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

const pickPhoto = async (page: Page, color: string): Promise<void> => {
  const png = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas context");
    context.fillStyle = fill;
    context.fillRect(0, 0, 96, 64);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, color);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Upload photo/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.getByRole("button", { name: "Use crop", exact: true }).click();
};

test("profile edits save after switching to a custom identity", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  await setBaseStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  const photos = new Map<string, Buffer>();
  const servePhotos = async (route: Route) => {
    const request = route.request();
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (request.method() === "PUT") {
      const body = request.postDataBuffer();
      if (!body) throw new Error("Empty photo upload");
      expect(request.headers()["content-type"]).toBe("image/jpeg");
      expect(body.subarray(0, 2).toString("hex")).toBe("ffd8");
      const sha256 = createHash("sha256").update(body).digest("hex");
      expect(request.headers()["x-sha-256"]).toBe(sha256);
      const url = `https://blossom.primal.net/${sha256}.jpg`;
      photos.set(url, body);
      await route.fulfill({ headers, json: { url, sha256 } });
      return;
    }
    const body = photos.get(request.url());
    if (!body) throw new Error(`Unknown photo ${request.url()}`);
    await route.fulfill({ headers, body, contentType: "image/jpeg" });
  };
  await page.route("https://blossom.primal.net/**", servePhotos);
  await page.addInitScript((nsec) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => nsec, writeText: async () => {} },
    });
  }, nip19.nsecEncode(secretKey));

  await page.goto("/");
  await page.getByRole("button", { name: "Create a profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Continue" }).click();
  await pickPhoto(page, "#3498db");
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByTestId("profile-qr-button")).toBeVisible();
  expect(photos.size).toBe(1);
  await page.goto("/#profile/edit");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Alice");
  const originalAddress = await page
    .getByRole("textbox", { name: "Lightning address", exact: true })
    .inputValue();

  await page.goto("/#advanced");
  const paste = page.getByRole("button", { name: "Paste custom nostr keys" });
  await paste.click();
  await paste.click();
  await expect(page).toHaveURL(/#contacts$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("linky.nostr_identity_source.v1"),
      ),
    )
    .toBe("custom");
  const keySwitchTime = nowSeconds();

  await page.goto("/#profile");
  await expect(page.getByTestId("profile-detail")).toContainText("Alice");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Lightning address", exact: true }),
  ).toHaveValue(originalAddress);
  await page.getByLabel("Name", { exact: true }).fill("Alice updated");
  await page.getByLabel("Status", { exact: true }).fill("Available");
  await pickPhoto(page, "#e74c3c");
  // Kind-0 replacements need a later second than the key-switch publish.
  await expect.poll(nowSeconds).toBeGreaterThan(keySwitchTime);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("profile-detail")).toContainText(
    "Alice updated",
  );
  await waitForProfileStatusOnRelay(nip19.npubEncode(pubkey), "Available");

  const pool = new SimplePool();
  try {
    const events = await pool.querySync([NOSTR_RELAY_URL], {
      authors: [pubkey],
      kinds: [0],
    });
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
    const metadata = Schema.decodeUnknownSync(
      Schema.parseJson(
        Schema.Struct({
          name: Schema.String,
          lud16: Schema.String,
          picture: Schema.String,
        }),
      ),
    )(newest?.content);
    expect(photos.size).toBe(2);
    expect(metadata).toEqual({
      name: "Alice updated",
      lud16: originalAddress,
      picture: [...photos.keys()][1],
    });

    await test.step("an independent reader loads the photo URL published on Nostr", async () => {
      const reader = await page.context().newPage();
      try {
        await reader.route("https://blossom.primal.net/**", servePhotos);
        await reader.goto(metadata.picture);
        await expect
          .poll(() =>
            reader
              .locator("img")
              .evaluate((image: HTMLImageElement) => image.naturalWidth),
          )
          .toBe(160);
      } finally {
        await reader.close();
      }
    });
  } finally {
    pool.close([NOSTR_RELAY_URL]);
  }
});
