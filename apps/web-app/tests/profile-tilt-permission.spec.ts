import { expect, test, type Page } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { setRandomIdentityStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

test.beforeEach(async ({ page }) => {
  await setBaseStorage(page);
  await setRandomIdentityStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
});

const tilt = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("devicemotion");
    Object.defineProperty(event, "accelerationIncludingGravity", {
      value: { x: 0, y: -9, z: 0 },
    });
    window.dispatchEvent(event);
  });

test("only the tilt toggle requests permission and a new launch requires a new grant", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("linky.inspector_enabled", "true");
    localStorage.setItem("linky.show_profile_qr_on_tilt.v2", "1");
    sessionStorage.setItem("test.motion.requests", "0");
    Object.defineProperty(DeviceMotionEvent, "requestPermission", {
      configurable: true,
      value: () => {
        sessionStorage.setItem(
          "test.motion.requests",
          String(Number(sessionStorage.getItem("test.motion.requests")) + 1),
        );
        return new Promise<PermissionState>((resolve, reject) => {
          window.addEventListener(
            "test:motion-permission",
            (event) => {
              if (!(event instanceof CustomEvent)) return;
              if (event.detail === "error") reject(new Error("Unavailable"));
              else resolve(event.detail === "granted" ? "granted" : "denied");
            },
            { once: true },
          );
        });
      },
    });
  });
  const requests = () =>
    page.evaluate(() => Number(sessionStorage.getItem("test.motion.requests")));
  const answer = (result: string) =>
    page.evaluate((detail) => {
      window.dispatchEvent(
        new CustomEvent("test:motion-permission", { detail }),
      );
    }, result);
  const toggle = page.getByRole("checkbox", { name: "Tilt to show profile" });
  const overlay = page.locator(".profile-share-overlay");

  await page.goto("/#");
  await page.locator("[data-guide='profile-qr-button']").click();
  await expect(page.locator(".profile-detail")).toBeVisible();
  expect(await requests()).toBe(0);
  await page.goto("/#settings");
  await expect(toggle).not.toBeChecked();
  await tilt(page);
  await expect(overlay).not.toBeVisible();
  expect(await requests()).toBe(0);

  for (const result of ["denied", "error"]) {
    const before = await requests();
    await toggle.click();
    await expect.poll(requests).toBe(before + 1);
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    expect(await requests()).toBe(before + 1);
    await answer(result);
    await expect(toggle).not.toBeChecked();
    await tilt(page);
    await expect(overlay).not.toBeVisible();
  }

  await toggle.click();
  await expect.poll(requests).toBe(3);
  await answer("granted");
  await expect(toggle).toBeChecked();
  await tilt(page);
  await expect(overlay).toBeVisible();
  await overlay.click();
  await page.goto("/#");
  await page.locator("[data-guide='profile-qr-button']").click();
  await expect(page.locator(".profile-detail")).toBeVisible();
  expect(await requests()).toBe(3);
  await page.goto("/#settings");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(await requests()).toBe(3);

  await toggle.click();
  await expect.poll(requests).toBe(4);
  await answer("granted");
  await expect(toggle).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("linky.show_profile_qr_on_tilt.v2"),
      ),
    )
    .toBe("1");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  expect(await requests()).toBe(0);
  await toggle.click();
  await expect.poll(requests).toBe(1);
  await answer("granted");
  await expect(toggle).toBeChecked();
  await page.goto("/#advanced/inspector/timeline");
  await page
    .getByRole("searchbox", { name: "Filter rows" })
    .fill("profileShare.tiltSettingChanged");
  await expect(
    page.getByText("Tilt to show profile enabled", { exact: true }),
  ).toBeVisible();
});

test("browsers without a permission API retain the saved tilt preference", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(DeviceMotionEvent, "requestPermission", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/#settings");
  const toggle = page.getByRole("checkbox", { name: "Tilt to show profile" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await tilt(page);
  await expect(page.locator(".profile-share-overlay")).toBeVisible();
});
