/**
 * The hosted lightning address against the stack's npubcash-server v3: a
 * payment arrives as a paid mint quote the wallet mints itself, and a new
 * default mint reaches the server.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { fetchUserInfo, payLightningAddress } from "./helpers/npubCash";
import { targetMintUrl } from "../../../packages/linkshu/tests/integration/helpers";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

const RECEIVED_SAT = 300;

test("a payment to the address is minted from its quote, and a new default mint reaches the server", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const identity = await createSeedIdentity();
  const errors = watchAppErrors(page, "owner");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);

  await payLightningAddress(identity.npub, RECEIVED_SAT);
  // The claim poll lists the server's quotes every 30 s.
  await expect
    .poll(() => readBalanceSat(page), { timeout: 60_000 })
    .toBe(RECEIVED_SAT);

  await page.goto("/#advanced/mints/new");
  // A bare host would get https:// prepended, which the local mint does not serve.
  await page.getByLabel("Mint URL").fill(targetMintUrl);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForURL(/#advanced\/mint\//);
  expect((await fetchUserInfo(identity.nsec)).mintUrl).toBe(targetMintUrl);
  errors.assertClean();
});
