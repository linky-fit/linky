/**
 * A lightning address is public and anyone can put any address in their
 * Nostr profile, so it never identifies a contact. A stranger copying a
 * contact's address can't take the contact over or receive its payments,
 * and address-only contacts are paid over Lightning.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Schema } from "effect";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { shardRows } from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import {
  publishProfileToRelay,
  sendDirectMessage,
  watchNostrInbox,
} from "./helpers/relay";
import { topUp } from "./helpers/wallet";

const ADDRESS_HOST = "pay.test";
const TARGET_MINT_URL =
  process.env.LINKSHU_TARGET_MINT_URL ?? "http://localhost:3339";
const FUNDING_SAT = 100;
const PAYMENT_SAT = 10;

const MintQuote = Schema.Struct({ request: Schema.String });

interface Account {
  context: BrowserContext;
  identity: SeedIdentity;
  /** Lightning address users whose LNURL callback issued an invoice. */
  invoicedUsers: string[];
  page: Page;
}

/** Serves LNURL-pay for every address on pay.test, invoiced by the second dev mint. */
const serveLightningAddresses = async (
  context: BrowserContext,
  invoicedUsers: string[],
): Promise<void> => {
  await context.route(`https://${ADDRESS_HOST}/**`, async (route) => {
    const headers = { "Access-Control-Allow-Origin": "*" };
    const url = new URL(route.request().url());
    const payRequest = url.pathname.match(/^\/\.well-known\/lnurlp\/([^/]+)$/);
    if (payRequest) {
      await route.fulfill({
        headers,
        json: {
          callback: `https://${ADDRESS_HOST}/lnurlp/${payRequest[1]}/callback`,
          maxSendable: 100_000_000,
          metadata: JSON.stringify([["text/plain", `Pay ${payRequest[1]}`]]),
          minSendable: 1_000,
          tag: "payRequest",
        },
      });
      return;
    }
    const callback = url.pathname.match(/^\/lnurlp\/([^/]+)\/callback$/);
    if (callback) {
      const response = await fetch(`${TARGET_MINT_URL}/v1/mint/quote/bolt11`, {
        body: JSON.stringify({
          amount: Number(url.searchParams.get("amount")) / 1000,
          unit: "sat",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const quote = Schema.decodeUnknownSync(MintQuote)(await response.json());
      invoicedUsers.push(callback[1]);
      await route.fulfill({ headers, json: { pr: quote.request, routes: [] } });
      return;
    }
    await route.fulfill({ headers, status: 404, body: "" });
  });
};

const boot = async (browser: Browser): Promise<Account> => {
  const identity = await createSeedIdentity();
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const invoicedUsers: string[] = [];
  await serveLightningAddresses(context, invoicedUsers);
  const page = await context.newPage();
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  const inboxReady = watchNostrInbox(page, identity.npub);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await inboxReady();
  return { context, identity, invoicedUsers, page };
};

const fund = async (account: Account): Promise<void> => {
  await topUp(account.page, FUNDING_SAT);
  await expect.poll(() => readBalanceSat(account.page)).toBe(FUNDING_SAT);
};

const liveContacts = async (page: Page) =>
  (await shardRows(page, "contacts", "contact")).filter(
    (row) => row.isDeleted !== 1,
  );

const contactRow = async (page: Page, id: string) =>
  (await liveContacts(page)).find((row) => row.id === id);

const addContactByLightningAddress = async (
  page: Page,
  name: string,
  address: string,
): Promise<string> => {
  const before = new Set((await liveContacts(page)).map((row) => row.id));
  await page.goto("/#contacts");
  await page.locator("[data-guide='contact-add-button']").first().click();
  await page.waitForURL(/#contact\/new$/);
  const search = page.locator("[data-guide='contact-search-input']");
  await search.fill(address);
  await search.press("Enter");
  await page
    .getByRole("button", { name: "Create contact", exact: true })
    .click({ timeout: 30_000 });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  let id = "";
  await expect
    .poll(async () => {
      const added = (await liveContacts(page)).find(
        (row) => !before.has(row.id) && row.name === name,
      );
      id = String(added?.id ?? "");
      return id;
    })
    .not.toBe("");
  return id;
};

const unknownSenderCards = (page: Page) =>
  page.locator(
    "[data-guide='contact-card'][data-guide-contact-id^='unknown:']",
  );

/** The attacker copies the address into their own profile and writes once. */
const copyAddressAndWrite = async (
  attacker: SeedIdentity,
  victim: Account,
  address: string,
  unknownSenders: number,
): Promise<void> => {
  await publishProfileToRelay(attacker.nsec, {
    lud16: address,
    name: "Mallory",
  });
  await sendDirectMessage(attacker.nsec, victim.identity.npub, "Hi, it's me");
  await victim.page.goto("/#contacts");
  await expect(unknownSenderCards(victim.page)).toHaveCount(unknownSenders, {
    timeout: 30_000,
  });
};

const enterAmount = async (page: Page, sats: number): Promise<void> => {
  for (const digit of String(sats).split("")) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
};

test("a copied address neither takes over a contact nor receives its payments, and an address-only contact is paid over Lightning", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const aliceAddress = `alice@${ADDRESS_HOST}`;
  const bobAddress = `bob@${ADDRESS_HOST}`;
  const victim = await boot(browser);
  const alice = await boot(browser);
  const attacker = await boot(browser);
  try {
    await publishProfileToRelay(alice.identity.nsec, {
      lud16: aliceAddress,
      name: "Alice",
    });
    await fund(victim);
    const aliceId = await addContactByNpub(victim.page, alice.identity.npub);
    await expect
      .poll(async () => (await contactRow(victim.page, aliceId))?.lnAddress, {
        message: "Alice's profile address is mirrored onto the contact",
        timeout: 30_000,
      })
      .toBe(aliceAddress);
    const bobId = await addContactByLightningAddress(
      victim.page,
      "Bob",
      bobAddress,
    );
    await addContactByNpub(alice.page, victim.identity.npub);
    await addContactByNpub(attacker.page, victim.identity.npub);

    await test.step("copied addresses link neither contact", async () => {
      await copyAddressAndWrite(attacker.identity, victim, aliceAddress, 1);
      const alicesContact = await contactRow(victim.page, aliceId);
      expect(alicesContact?.npub).toBe(alice.identity.npub);
      expect(alicesContact?.name).toBe("Alice");

      await copyAddressAndWrite(
        await createSeedIdentity(),
        victim,
        bobAddress,
        2,
      );
      expect((await contactRow(victim.page, bobId))?.npub ?? null).toBeNull();
    });

    await test.step("Alice is paid over Nostr, never the attacker", async () => {
      await victim.page.goto(`/#contact/${encodeURIComponent(aliceId)}/pay`);
      await enterAmount(victim.page, PAYMENT_SAT);
      await victim.page.locator("[data-guide='pay-send']").click();

      await alice.page.goto("/#wallet");
      await expect
        .poll(() => readBalanceSat(alice.page), { timeout: 60_000 })
        .toBeGreaterThan(0);
      await attacker.page.goto("/#wallet");
      expect(await readBalanceSat(attacker.page)).toBe(0);
    });

    await test.step("Bob is paid over Lightning", async () => {
      await victim.page.goto(`/#contact/${encodeURIComponent(bobId)}/pay`);
      await enterAmount(victim.page, PAYMENT_SAT);
      await victim.page.locator("[data-guide='pay-send']").click();
      await expect(victim.page).toHaveURL(/#payln\/bob%40pay\.test$/);
      // Paying a chosen contact still names it.
      await expect(victim.page.getByText("Bob", { exact: true })).toBeVisible();
      await victim.page
        .getByRole("button", { name: "Pay", exact: true })
        .click();

      await expect.poll(() => victim.invoicedUsers).toEqual(["bob"]);
      await victim.page.goto("/#wallet");
      await expect
        .poll(() => readBalanceSat(victim.page))
        .toBeLessThanOrEqual(FUNDING_SAT - 2 * PAYMENT_SAT);
    });
  } finally {
    for (const account of [victim, alice, attacker]) {
      await account.context.close();
    }
  }
});
