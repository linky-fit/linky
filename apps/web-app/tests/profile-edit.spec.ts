import { expect, test } from "@playwright/test";
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

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

test("profile edits save after switching to a custom identity", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  await setBaseStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
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
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByTestId("profile-qr-button")).toBeVisible();
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

  await page.goto("/#profile");
  await expect(page.getByTestId("profile-detail")).toContainText("Alice");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Lightning address", exact: true }),
  ).toHaveValue(originalAddress);
  await page.getByLabel("Name", { exact: true }).fill("Alice updated");
  await page.getByLabel("Status", { exact: true }).fill("Available");
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
        }),
      ),
    )(newest?.content);
    expect(metadata).toEqual({ name: "Alice updated", lud16: originalAddress });
  } finally {
    pool.close([NOSTR_RELAY_URL]);
  }
});
