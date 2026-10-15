import { expect, test } from "@playwright/test";
import { NOSTR_SLIP39_SEED_STORAGE_KEY } from "../src/utils/constants";
import { deriveNostrKeysFromSlip39 } from "../src/utils/slip39Nostr";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";

// The unsupported result is covered by passwordManager.test.ts and MasterKeysPage.test.tsx.
for (const { serviceWorkers, saveResult } of [
  { serviceWorkers: "allow", saveResult: "saved" },
  { serviceWorkers: "block", saveResult: "failed" },
] as const) {
  test.describe(`password save with service workers ${serviceWorkers}`, () => {
    test.use({ serviceWorkers });

    test(`signup and manual backup keep the seed off HTTP when ${saveResult}`, async ({
      page,
      context,
    }) => {
      const errors = watchAppErrors(page, "fresh signup");
      const requests: { url: string; body: string }[] = [];
      context.on("request", (request) => {
        requests.push({ url: request.url(), body: request.postData() ?? "" });
      });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await setBaseStorage(page);
      await stubFiatRates(page);
      await page.addInitScript((result) => {
        Object.defineProperty(navigator, "credentials", {
          configurable: true,
          value: {
            store: async (credential: { id: string; password: string }) => {
              sessionStorage.setItem(
                "e2e.password-save-count",
                String(
                  Number(
                    sessionStorage.getItem("e2e.password-save-count") ?? "0",
                  ) + 1,
                ),
              );
              sessionStorage.setItem("e2e.saved-credential-id", credential.id);
              if (result === "failed")
                throw new Error("Password manager rejected save");
              sessionStorage.setItem("e2e.saved-password", credential.password);
              return credential;
            },
          },
        });
      }, saveResult);

      await page.goto("/");
      if (serviceWorkers === "allow") {
        await expect
          .poll(() =>
            page.evaluate(() => navigator.serviceWorker.controller !== null),
          )
          .toBe(true);
      }
      await page.getByRole("button", { name: "Create a profile" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Confirm profile" }).click();
      await expect(
        page.locator("[data-guide='contact-add-button']"),
      ).toBeVisible();

      const seed = await page.evaluate(
        (key) => localStorage.getItem(key),
        NOSTR_SLIP39_SEED_STORAGE_KEY,
      );
      if (!seed) throw new Error("Signup did not persist its recovery seed");
      const identity = await deriveNostrKeysFromSlip39(seed);
      if (!identity) throw new Error("Signup seed did not derive an identity");
      const assertCredentialId = async () => {
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("e2e.saved-credential-id"),
          ),
        ).toBe(`linky.seed:${identity.npub}`);
      };
      await assertCredentialId();
      const assertNoSeedRequests = () => {
        expect(
          requests.filter(
            ({ url }) => new URL(url).pathname === "/password-save.html",
          ).length,
        ).toBe(0);
        const encodings = [
          seed,
          encodeURIComponent(seed),
          new URLSearchParams({ password: seed })
            .toString()
            .slice("password=".length),
        ];
        expect(
          requests.some(({ url, body }) =>
            encodings.some(
              (encoded) => url.includes(encoded) || body.includes(encoded),
            ),
          ),
        ).toBe(false);
      };
      assertNoSeedRequests();

      await page.goto("/#settings/master-keys");
      await page.getByRole("button", { name: "Save to passwords" }).click();
      await expect(
        page.getByText(
          saveResult === "saved"
            ? "Password manager save requested."
            : "Password manager save failed.",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          Number(sessionStorage.getItem("e2e.password-save-count") ?? "0"),
        ),
      ).toBe(2);
      assertNoSeedRequests();
      await assertCredentialId();

      if (saveResult === "saved") {
        expect(
          await page.evaluate(
            (key) =>
              sessionStorage.getItem("e2e.saved-password") ===
              localStorage.getItem(key),
            NOSTR_SLIP39_SEED_STORAGE_KEY,
          ),
        ).toBe(true);

        const contact = await createSeedIdentity();
        const contactId = await addContactByNpub(page, contact.npub);
        const message = "First message after signing up";
        await page.locator('[data-guide="chat-input"]').fill(message);
        await page.locator('[data-guide="chat-send"]').click();
        await expect(
          page.getByTestId("chat-bubble").filter({ hasText: message }),
        ).toBeVisible();

        await page.reload();
        await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
        await expect(
          page.getByTestId("chat-bubble").filter({ hasText: message }),
        ).toBeVisible();
        await page.goto("/#contacts");
        const contactCard = page.locator('[data-guide="contact-card"]');
        await expect(contactCard).toHaveCount(1);
        await contactCard.click();
        await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
        await expect(
          page.getByTestId("chat-bubble").filter({ hasText: message }),
        ).toBeVisible();
        assertNoSeedRequests();
      }
      errors.assertClean();
    });
  });
}
