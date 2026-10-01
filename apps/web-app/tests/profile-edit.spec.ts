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
import {
  npubToHex,
  publishProfileToRelay,
  waitForProfileStatusOnRelay,
} from "./helpers/relay";
import { NOSTR_RELAY_URL } from "./helpers/stack";
import { AVATAR_SIZE_PX } from "../src/utils/image";
import { nowSeconds } from "../src/utils/time";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

const decodeProfileContent = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

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

  await page.goto("/#advanced");
  const paste = page.getByRole("button", { name: "Paste custom nostr keys" });
  await paste.click();
  await paste.click();
  await expect(page).toHaveURL(/#contacts$/);
  await page.goto("/#advanced");
  await expect(
    page.getByRole("button", { name: "Switch back to default identity" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("linky.nostr_identity_source.v1"),
      ),
    )
    .toBe("custom");
  const keySwitchTime = nowSeconds();
  const customKeyAddress = `${nip19.npubEncode(pubkey)}@linky.fit`;

  await page.goto("/#profile");
  await expect(page.getByTestId("profile-detail")).toContainText("Alice");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Lightning address", exact: true }),
  ).toHaveValue(customKeyAddress);
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
      Schema.fromJsonString(
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
      lud16: customKeyAddress,
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
          .toBe(AVATAR_SIZE_PX);
      } finally {
        await reader.close();
      }
    });

    await test.step("switching back to the default identity hides the row again", async () => {
      await page.goto("/#advanced");
      const switchBack = page.getByRole("button", {
        name: "Switch back to default identity",
      });
      await switchBack.click();
      await switchBack.click();
      // The default identity has its onboarding profile, so Linky asks.
      await expect(page.getByTestId("identity-profile-preview")).toBeVisible();
      await page.getByRole("button", { name: "Switch identity" }).click();
      await expect(page).toHaveURL(/#contacts$/);
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("linky.nostr_identity_source.v1"),
          ),
        )
        .toBe("derived");
      await page.goto("/#advanced");
      await expect(
        page.getByRole("button", { name: "Paste custom nostr keys" }),
      ).toBeVisible();
      await expect(switchBack).toHaveCount(0);
    });
  } finally {
    pool.close([NOSTR_RELAY_URL]);
  }
});

test("switching to a custom identity with a profile lets the user keep the Linky profile, import the Nostr one, or cancel", async ({
  page,
}) => {
  const bob = generateSecretKey();
  const carol = generateSecretKey();
  const bobNpub = nip19.npubEncode(getPublicKey(bob));
  const carolNpub = nip19.npubEncode(getPublicKey(carol));
  await publishProfileToRelay(nip19.nsecEncode(bob), {
    name: "Bob",
    about: "Bob's bio",
    website: "https://bob.example",
  });
  await publishProfileToRelay(nip19.nsecEncode(carol), {
    name: "Carol",
    website: "https://carol.example",
  });
  const existingProfileTime = nowSeconds();
  await setBaseStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => sessionStorage.getItem("test.clipboard") ?? "",
        writeText: async () => {},
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create a profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByTestId("profile-qr-button")).toBeVisible();

  const pool = new SimplePool();
  const newestRelayProfile = async (npub: string) => {
    const events = await pool.querySync([NOSTR_RELAY_URL], {
      authors: [npubToHex(npub)],
      kinds: [0],
    });
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
    return newest ? decodeProfileContent(newest.content) : null;
  };
  const identitySource = () =>
    page.evaluate(() => localStorage.getItem("linky.nostr_identity_source.v1"));
  const choice = page.getByTestId("identity-profile-choice");
  const preview = page.getByTestId("identity-profile-preview");
  const requestSwitch = async (secretKey: Uint8Array) => {
    await page.goto("/#advanced");
    await page.evaluate(
      (nsec) => sessionStorage.setItem("test.clipboard", nsec),
      nip19.nsecEncode(secretKey),
    );
    const paste = page.getByRole("button", { name: "Paste custom nostr keys" });
    await paste.click();
    await paste.click();
    await expect(choice).toBeVisible();
  };
  const switchIdentity = async () => {
    await expect.poll(nowSeconds).toBeGreaterThan(existingProfileTime);
    await page.getByRole("button", { name: "Switch identity" }).click();
    await expect(page).toHaveURL(/#contacts$/);
  };

  try {
    await test.step("cancel keeps the current identity", async () => {
      await requestSwitch(bob);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(choice).toBeHidden();
      await expect(page).toHaveURL(/#advanced$/);
      expect(await identitySource()).not.toBe("custom");
      expect(await newestRelayProfile(bobNpub)).toEqual({
        name: "Bob",
        about: "Bob's bio",
        website: "https://bob.example",
      });
    });

    await test.step("using the Nostr profile imports it with the Linky address", async () => {
      await requestSwitch(bob);
      await expect(preview).toContainText("Alice");
      await page.getByRole("radio", { name: "Use Nostr profile" }).click();
      await expect(preview).toContainText("Bob's bio");
      await expect(preview).toContainText(`${bobNpub}@linky.fit`);
      await switchIdentity();
      await expect.poll(identitySource).toBe("custom");
      await expect
        .poll(() => newestRelayProfile(bobNpub))
        .toEqual({
          name: "Bob",
          about: "Bob's bio",
          website: "https://bob.example",
          lud16: `${bobNpub}@linky.fit`,
        });
      await page.goto("/#profile");
      await expect(page.getByTestId("profile-detail")).toContainText("Bob");
    });

    await test.step("keeping the Linky profile overwrites the identity's own", async () => {
      await requestSwitch(carol);
      await expect(preview).toContainText("Bob");
      await switchIdentity();
      await expect
        .poll(() => newestRelayProfile(carolNpub))
        .toEqual({
          name: "Bob",
          about: "Bob's bio",
          website: "https://carol.example",
          lud16: `${carolNpub}@linky.fit`,
        });
    });
  } finally {
    pool.close([NOSTR_RELAY_URL]);
  }
});
