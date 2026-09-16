import { expect, test } from "@playwright/test";
import { NOSTR_SLIP39_SEED_STORAGE_KEY } from "../src/utils/constants";
import { deriveNostrKeysFromSlip39 } from "../src/utils/slip39Nostr";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";

for (const serviceWorkers of ["allow", "block"] as const) {
  test.describe(`password save with service workers ${serviceWorkers}`, () => {
    test.use({ serviceWorkers });

    for (const saveResult of ["saved", "unsupported", "failed"] as const) {
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
          if (result === "unsupported") {
            Object.defineProperty(globalThis, "PasswordCredential", {
              value: undefined,
              configurable: true,
            });
          }
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
                sessionStorage.setItem(
                  "e2e.saved-credential-id",
                  credential.id,
                );
                if (result === "failed")
                  throw new Error("Password manager rejected save");
                sessionStorage.setItem(
                  "e2e.saved-password",
                  credential.password,
                );
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
        await expect(page.getByLabel("Available balance")).toBeVisible();

        const seed = await page.evaluate(
          (key) => localStorage.getItem(key),
          NOSTR_SLIP39_SEED_STORAGE_KEY,
        );
        if (!seed) throw new Error("Signup did not persist its recovery seed");
        const identity = await deriveNostrKeysFromSlip39(seed);
        if (!identity)
          throw new Error("Signup seed did not derive an identity");
        const assertCredentialId = async () => {
          expect(
            await page.evaluate(() =>
              sessionStorage.getItem("e2e.saved-credential-id"),
            ),
          ).toBe(
            saveResult === "unsupported" ? null : `linky.seed:${identity.npub}`,
          );
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
        const feedback =
          saveResult === "saved"
            ? "Password manager save requested."
            : saveResult === "unsupported"
              ? "Password manager save isn't available in this browser."
              : "Password manager save failed.";
        await expect(page.getByText(feedback, { exact: true })).toBeVisible();
        expect(
          await page.evaluate(() =>
            Number(sessionStorage.getItem("e2e.password-save-count") ?? "0"),
          ),
        ).toBe(saveResult === "unsupported" ? 0 : 2);
        if (saveResult === "saved") {
          expect(
            await page.evaluate(
              (key) =>
                sessionStorage.getItem("e2e.saved-password") ===
                localStorage.getItem(key),
              NOSTR_SLIP39_SEED_STORAGE_KEY,
            ),
          ).toBe(true);
        }
        assertNoSeedRequests();
        await assertCredentialId();

        if (serviceWorkers === "allow" && saveResult === "saved") {
          const contact = await createSeedIdentity();
          const contactId = await addContactByNpub(page, contact.npub);
          const message = "First message after signing up";
          await page.locator('[data-guide="chat-input"]').fill(message);
          await page.locator('[data-guide="chat-send"]').click();
          await expect(
            page.locator(".chat-bubble").filter({ hasText: message }),
          ).toBeVisible();

          await page.reload();
          await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
          await expect(
            page.locator(".chat-bubble").filter({ hasText: message }),
          ).toBeVisible();
          await page.goto("/#contacts");
          const contactCard = page.locator('[data-guide="contact-card"]');
          await expect(contactCard).toHaveCount(1);
          await contactCard.click();
          await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
          await expect(
            page.locator(".chat-bubble").filter({ hasText: message }),
          ).toBeVisible();
        }
        assertNoSeedRequests();
        errors.assertClean();
      });
    }
  });
}
