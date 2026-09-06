/**
 * Linkshu storage migration — an upgrading device's wallet survives the
 * cutover (#307/#308).
 *
 * Seeds legacy-format localStorage BEFORE first app launch: a deterministic
 * counter and restore cursor scoped to the real dev-mint keyset, a legacy
 * seen-mints array, PAID-but-unclaimed pending topup and autoswap-claim
 * records for real dev-mint quotes (FakeWallet settles their invoices
 * automatically), delete-only claim records, and the pre-cutover
 * `linky.lastAcceptedCashuToken.v1` leftover. Then launches the app and
 * asserts the one-time migration renamed the counter/cursor byte-for-byte
 * into linkshu's keys, converted the pending records so linkshu's resume
 * path claims both quotes into balance, retired the legacy keys it owns
 * (seen-mints arrays stay — the mints UI still reads them), and that a
 * top-up (balance) and a Lightning invoice payment both work with
 * derivation continuing from the migrated counter slot. A mid-test reload
 * proves the migrated state and balance survive a relaunch without
 * re-running the migration.
 *
 * Needs the docker stack up — see "E2E tests" in CLAUDE.md.
 *
 * Honest limits: pre-existing Evolu token rows cannot be seeded before
 * launch — the legacy writers that produced them are deleted, and Evolu's
 * SQLite lives in OPFS behind owner-derived encryption — so "migrated
 * balance intact" is asserted as balance created through the migrated
 * counter accounting surviving a relaunch, not as pre-seeded rows.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";

/** VITE_MAIN_MINT_URL baked into the e2e image (docker-compose.dev.yml). */
const MINT_URL = "http://localhost:3338";
const TARGET_MINT_URL = "http://localhost:3339";
const UNIT = "sat";

const FUNDING_SAT = 100;
const INVOICE_SAT = 21;
/** Seeded pending records; their sum stays below FUNDING_SAT so the topup
 * step's balance poll cannot pass on the resumed claims alone. */
const PENDING_TOPUP_SAT = 53;
const PENDING_AUTOSWAP_SAT = 21;
/** input_fee_ppk: 100 on the dev mint plus the melt fee reserve. */
const MAX_PAYMENT_FEE_SAT = 3;

const LEGACY_COUNTER_VALUE = "7";
const LEGACY_CURSOR_VALUE = "5";

/** Decoy scope no resumed claim touches: proves the byte-for-byte copy
 * without racing the converted pending records' claims, which advance the
 * live-scope counter as soon as the runtime is up. The values must stay
 * below LEGACY_COUNTER_VALUE so the migration's keyset lookup (highest
 * counter wins) still binds the converted records to the real keyset. */
const DECOY_KEYSET_ID = "00decoy";
const DECOY_COUNTER_VALUE = "3";
const DECOY_CURSOR_VALUE = "2";

const MIGRATION_DONE_KEY = "linky.linkshu_storage_migration_v1";
const LAST_ACCEPTED_KEY = "linky.lastAcceptedCashuToken.v1";

/** Key shapes pinned by linkshuStorageMigration.ts and its unit tests. */
const legacyScope = (keysetId: string): string =>
  [MINT_URL, UNIT, keysetId].map(encodeURIComponent).join(":");
const linkshuScope = (keysetId: string): string =>
  [MINT_URL, UNIT, keysetId].map(encodeURIComponent).join(".");

const legacyKeys = (keysetId: string) => ({
  counter: `linky.cashu.detCounter.v1:${legacyScope(keysetId)}`,
  cursor: `linky.cashu.restoreCursor.v1:${legacyScope(keysetId)}`,
  counterLock: `linky.cashu.detCounterLock.v1:${legacyScope(keysetId)}`,
  seenMints: "linky.cashu.seenMints.v1.legacyOwnerId",
  pendingTopup: "linky.local.pendingTopupQuote.v1.legacyOwnerId",
  pendingTopupMalformed: "linky.local.pendingTopupQuote.v1.quote1",
  pendingAutoswap: "linky.local.pendingAutoswapClaim.v1.legacyOwnerId",
  topupClaimed: "linky.topup.claimed.v1.quote1",
  autoswapClaimed: "linky.autoswap.claimed.v1.claim1",
});

const linkshuKeys = (keysetId: string) => ({
  counter: `linky.linkshu.value.linkshu.detCounter.${linkshuScope(keysetId)}`,
  cursor: `linky.linkshu.value.linkshu.restoreCursor.${linkshuScope(keysetId)}`,
  seenMint: `linky.linkshu.value.linkshu.seenMints.${encodeURIComponent(MINT_URL)}`,
  pendingTopup: (quoteId: string) =>
    `linky.linkshu.value.linkshu.pendingTopup.${[MINT_URL, quoteId].map(encodeURIComponent).join(".")}`,
  pendingAutoswap: (quoteId: string) =>
    `linky.linkshu.value.linkshu.pendingAutoswapClaim.${[MINT_URL, quoteId].map(encodeURIComponent).join(".")}`,
});

interface MintKeysetEntry {
  readonly active?: unknown;
  readonly id?: unknown;
  readonly unit?: unknown;
}

const isMintKeysetEntry = (value: unknown): value is MintKeysetEntry =>
  typeof value === "object" && value !== null;

const fetchActiveSatKeysetId = async (
  request: APIRequestContext,
): Promise<string> => {
  const response = await request.get(`${MINT_URL}/v1/keysets`);
  expect(response.ok(), "dev mint must be reachable (docker stack up?)").toBe(
    true,
  );
  const body: unknown = await response.json();
  const keysets =
    typeof body === "object" && body !== null && "keysets" in body
      ? body.keysets
      : null;
  if (!Array.isArray(keysets)) throw new Error("unexpected /v1/keysets shape");
  for (const keyset of keysets.filter(isMintKeysetEntry)) {
    if (
      keyset.unit === UNIT &&
      keyset.active !== false &&
      typeof keyset.id === "string"
    ) {
      return keyset.id;
    }
  }
  throw new Error(`no active ${UNIT} keyset at ${MINT_URL}`);
};

const createMintQuote = async (
  request: APIRequestContext,
  amountSat: number,
  mintUrl = MINT_URL,
): Promise<{ invoice: string; quoteId: string }> => {
  const response = await request.post(`${mintUrl}/v1/mint/quote/bolt11`, {
    data: { amount: amountSat, unit: UNIT },
  });
  expect(response.ok(), "mint quote request").toBe(true);
  const body: unknown = await response.json();
  const invoice =
    typeof body === "object" && body !== null && "request" in body
      ? body.request
      : null;
  const quoteId =
    typeof body === "object" && body !== null && "quote" in body
      ? body.quote
      : null;
  if (typeof invoice !== "string" || !invoice.startsWith("ln")) {
    throw new Error("mint quote returned no bolt11 invoice");
  }
  if (typeof quoteId !== "string" || quoteId.length === 0) {
    throw new Error("mint quote returned no quote id");
  }
  return { invoice, quoteId };
};

const createMintInvoice = async (
  request: APIRequestContext,
  amountSat: number,
): Promise<string> =>
  (await createMintQuote(request, amountSat, TARGET_MINT_URL)).invoice;

const readStorage = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

test("legacy cashu storage migrates and the wallet keeps working", async ({
  browser,
  request,
}) => {
  const keysetId = await fetchActiveSatKeysetId(request);
  const legacy = legacyKeys(keysetId);
  const linkshu = linkshuKeys(keysetId);
  const legacyDecoy = legacyKeys(DECOY_KEYSET_ID);
  const linkshuDecoy = linkshuKeys(DECOY_KEYSET_ID);

  const identity = await createSeedIdentity();
  const context = await browser.newContext({
    // Playwright cannot intercept service-worker requests (src/sw.ts caches
    // cross-origin images), so the asset stubs below need SWs off.
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, "M");

  try {
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);

    // Real dev-mint quotes for the pending records; FakeWallet settles their
    // invoices by itself, so both are PAID but unclaimed — the exact state
    // the pre-fix migration stranded by deleting the records (the quote id
    // is the only claim handle; no outputs exist at the mint to restore).
    const pendingTopupQuote = await createMintQuote(request, PENDING_TOPUP_SAT);
    const pendingAutoswapQuote = await createMintQuote(
      request,
      PENDING_AUTOSWAP_SAT,
    );

    await test.step("seed legacy-format storage before first launch", async () => {
      const legacyPendingTopupRecord = {
        amount: PENDING_TOPUP_SAT,
        createdAtMs: Date.now(),
        invoice: pendingTopupQuote.invoice,
        mintUrl: MINT_URL,
        quote: pendingTopupQuote.quoteId,
        unit: UNIT,
      };
      const legacyPendingAutoswapRecord = {
        amount: PENDING_AUTOSWAP_SAT,
        createdAtMs: Date.now(),
        invoice: pendingAutoswapQuote.invoice,
        mintUrl: MINT_URL,
        quote: pendingAutoswapQuote.quoteId,
        unit: UNIT,
      };
      await page.addInitScript(
        ([
          keys,
          counterValue,
          cursorValue,
          decoyCounterValue,
          decoyCursorValue,
          mintUrl,
          lastAcceptedKey,
          pendingTopupJson,
          pendingAutoswapJson,
        ]) => {
          try {
            // Seed only on the first load; a reload after migration must not
            // resurrect the deleted legacy keys.
            const sentinel = "linky.test.legacy-storage-seeded";
            if (sessionStorage.getItem(sentinel) === "1") return;
            sessionStorage.setItem(sentinel, "1");

            localStorage.setItem(keys.counter, counterValue);
            localStorage.setItem(keys.cursor, cursorValue);
            localStorage.setItem(keys.decoyCounter, decoyCounterValue);
            localStorage.setItem(keys.decoyCursor, decoyCursorValue);
            localStorage.setItem(keys.counterLock, String(Date.now()));
            localStorage.setItem(keys.seenMints, JSON.stringify([mintUrl]));
            localStorage.setItem(keys.pendingTopup, pendingTopupJson);
            localStorage.setItem(
              keys.pendingTopupMalformed,
              JSON.stringify({ quoteId: "quote1" }),
            );
            localStorage.setItem(keys.pendingAutoswap, pendingAutoswapJson);
            localStorage.setItem(keys.topupClaimed, "1");
            localStorage.setItem(keys.autoswapClaimed, "1");
            // Pre-cutover code cleared this by writing "", so an upgrading
            // device typically carries the empty leftover.
            localStorage.setItem(lastAcceptedKey, "");
          } catch {
            // ignore
          }
        },
        [
          {
            ...legacy,
            decoyCounter: legacyDecoy.counter,
            decoyCursor: legacyDecoy.cursor,
          },
          LEGACY_COUNTER_VALUE,
          LEGACY_CURSOR_VALUE,
          DECOY_COUNTER_VALUE,
          DECOY_CURSOR_VALUE,
          MINT_URL,
          LAST_ACCEPTED_KEY,
          JSON.stringify(legacyPendingTopupRecord),
          JSON.stringify([legacyPendingAutoswapRecord]),
        ] as const,
      );
    });

    await test.step("first launch runs the migration", async () => {
      await page.goto("/#wallet");
      await waitForNetworkReady(page);
      await expectNoBootErrorPanel(page, "M");

      await expect
        .poll(() => readStorage(page, MIGRATION_DONE_KEY), { timeout: 60_000 })
        .toBe("1");

      // The byte-for-byte copy is proven on the decoy scope, which no claim
      // touches; the live-scope counter races the resumed pending-record
      // claims (each consumes a 64-slot block), so it only ever grows from
      // the copied value. Cursors are untouched by claims.
      expect(await readStorage(page, linkshuDecoy.counter)).toBe(
        DECOY_COUNTER_VALUE,
      );
      expect(await readStorage(page, linkshuDecoy.cursor)).toBe(
        DECOY_CURSOR_VALUE,
      );
      expect(await readStorage(page, legacyDecoy.counter)).toBeNull();
      expect(await readStorage(page, legacyDecoy.cursor)).toBeNull();
      expect(
        Number(await readStorage(page, linkshu.counter)),
      ).toBeGreaterThanOrEqual(Number(LEGACY_COUNTER_VALUE));
      expect(await readStorage(page, linkshu.cursor)).toBe(LEGACY_CURSOR_VALUE);
      expect(await readStorage(page, linkshu.seenMint)).toBe(MINT_URL);

      // Renamed and delete-only legacy keys are gone; the legacy seen-mints
      // array deliberately stays — the mints UI still owns it.
      const { seenMints, ...removedLegacyKeys } = legacy;
      for (const key of Object.values(removedLegacyKeys)) {
        expect(await readStorage(page, key), key).toBeNull();
      }
      expect(await readStorage(page, seenMints)).toBe(
        JSON.stringify([MINT_URL]),
      );

      // The one-shot drain retires the last-accepted leftover.
      await expect
        .poll(() => readStorage(page, LAST_ACCEPTED_KEY), { timeout: 60_000 })
        .toBeNull();

      // The malformed pending record was dropped, not converted: no linkshu
      // pending-topup key references its quote id.
      const pendingTopupKeys = await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("linky.linkshu.value.linkshu.pendingTopup."),
        ),
      );
      expect(pendingTopupKeys.filter((key) => key.endsWith(".quote1"))).toEqual(
        [],
      );
    });

    await test.step("converted pending records are claimed into balance", async () => {
      await expect
        .poll(() => readBalanceSat(page), { timeout: 120_000 })
        .toBeGreaterThanOrEqual(PENDING_TOPUP_SAT + PENDING_AUTOSWAP_SAT);

      // Claim completion retires the converted linkshu pending records.
      await expect
        .poll(
          () =>
            readStorage(page, linkshu.pendingTopup(pendingTopupQuote.quoteId)),
          { timeout: 60_000 },
        )
        .toBeNull();
      await expect
        .poll(
          () =>
            readStorage(
              page,
              linkshu.pendingAutoswap(pendingAutoswapQuote.quoteId),
            ),
          { timeout: 60_000 },
        )
        .toBeNull();
    });

    await test.step("top-up derives from the migrated counter", async () => {
      await topUp(page, FUNDING_SAT);
      await expect
        .poll(() => readBalanceSat(page), { timeout: 120_000 })
        .toBeGreaterThanOrEqual(FUNDING_SAT);

      // Minting consumed deterministic slots starting at the migrated value.
      const counter = Number(await readStorage(page, linkshu.counter));
      expect(counter).toBeGreaterThan(Number(LEGACY_COUNTER_VALUE));
    });

    const balanceBeforeReload = await readBalanceSat(page);
    let counterBeforeReload = "";

    await test.step("relaunch keeps the migrated state and balance", async () => {
      counterBeforeReload = String(await readStorage(page, linkshu.counter));

      await page.reload();
      await waitForNetworkReady(page);
      await expectNoBootErrorPanel(page, "M");

      await expect
        .poll(() => readBalanceSat(page), { timeout: 60_000 })
        .toBe(balanceBeforeReload);

      expect(await readStorage(page, MIGRATION_DONE_KEY)).toBe("1");
      expect(await readStorage(page, linkshu.counter)).toBe(
        counterBeforeReload,
      );
      expect(await readStorage(page, legacy.counter)).toBeNull();
      expect(await readStorage(page, legacy.cursor)).toBeNull();
    });

    await test.step("a Lightning payment succeeds after the migration", async () => {
      const invoice = await createMintInvoice(request, INVOICE_SAT);

      await page.goto("/#wallet/pay");
      const input = page.locator("#manual-pay-input");
      await input.fill(invoice);
      await input.press("Enter");

      // INVOICE_SAT is under the default auto-pay limit, so the payment runs
      // without a confirmation step; the balance drop is the settlement.
      await expect
        .poll(() => readBalanceSat(page), { timeout: 120_000 })
        .toBeLessThanOrEqual(balanceBeforeReload - INVOICE_SAT);

      // Melt change lands as its own row, so poll past any transient dip
      // before pinning the fee upper bound.
      await expect
        .poll(() => readBalanceSat(page), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(
          balanceBeforeReload - INVOICE_SAT - MAX_PAYMENT_FEE_SAT,
        );
    });

    await expectNoBootErrorPanel(page, "M");
    errors.assertClean();
  } finally {
    await context.close();
  }
});
