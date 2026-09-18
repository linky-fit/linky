import { expect, test, type Browser, type Page } from "@playwright/test";
import type { OwnerRole } from "@linky/identity";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
import { deriveEvoluOwnerMnemonicFromSlip39 } from "../src/utils/slip39Nostr";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setRandomIdentityStorage,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

/**
 * The lanes are seeded through `window.__linkyE2E` (a VITE_E2E build hook)
 * with rows written straight under the legacy lane owners, the way an
 * older app version writes them, so the spec keeps working once the app
 * itself stops writing to the lanes (#384 to #387).
 */

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const DONE_FLAG = "linky.laneMigration.done.v1";
const PUBKEY_HEX = "ab".repeat(32);

test.use({ actionTimeout: 20_000 });

type Row = Readonly<Record<string, unknown>>;

const hooks = {
  appOwnerId: (page: Page) =>
    page.evaluate(() => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.appOwnerId();
    }),
  useOwners: (page: Page, mnemonics: ReadonlyArray<string>) =>
    page.evaluate((list) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.useOwners(list);
    }, mnemonics),
  upsert: (page: Page, table: string, row: Row, ownerId: string) =>
    page.evaluate(
      ({ table, row, ownerId }) => {
        if (!window.__linkyE2E) throw new Error("test hooks missing");
        return window.__linkyE2E.upsert(table, row, ownerId);
      },
      { table, row, ownerId },
    ),
  shardRows: (page: Page, scope: string, table: string) =>
    page.evaluate(
      ({ scope, table }) => {
        if (!window.__linkyE2E) throw new Error("test hooks missing");
        return window.__linkyE2E.shardRows(scope, table);
      },
      { scope, table },
    ),
  createId: (page: Page) =>
    page.evaluate(() => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.createId();
    }),
  conversationIdFor: (page: Page, contactId: string) =>
    page.evaluate((id) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.directConversationIdFor(id);
    }, contactId),
  activeNostrIdentityId: (page: Page) =>
    page.evaluate(() => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.activeNostrIdentityId;
    }),
};

const openDevice = async (
  browser: Browser,
  baseURL: string | undefined,
  label: string,
  login: (page: Page) => Promise<void>,
) => {
  const context = await browser.newContext({
    baseURL,
    serviceWorkers: "block",
    viewport: MOBILE_VIEWPORT,
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await login(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible({
    timeout: 60_000,
  });
  return { context, page, errors };
};

/** Clears the local done flag so the next boot runs the migration behind the screen again. */
const rerunMigration = async (page: Page): Promise<void> => {
  await page.evaluate((flag) => localStorage.removeItem(flag), DONE_FLAG);
  await page.reload();
  await expect(page.getByLabel("Available balance")).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => page.evaluate((flag) => localStorage.getItem(flag), DONE_FLAG))
    .toBe("1");
};

const laneMnemonics = async (
  identity: SeedIdentity,
  lanes: ReadonlyArray<readonly [OwnerRole, number]>,
): Promise<string[]> =>
  Promise.all(
    lanes.map(async ([role, index]) => {
      const mnemonic = await deriveEvoluOwnerMnemonicFromSlip39(
        identity.share,
        role,
        index,
      );
      if (!mnemonic) throw new Error(`no mnemonic for ${role}-${index}`);
      return mnemonic;
    }),
  );

const byName = (rows: ReadonlyArray<Row>): string[] =>
  rows.map((row) => String(row.name)).sort();

test("owner lanes migrate into shards, a fresh device reads them from the relay, and a later lane write is re-ingested", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const peer = await createSeedIdentity();
  const baseURL = testInfo.project.use.baseURL;
  const source = await openDevice(browser, baseURL, "migrated", (page) =>
    setSeedLoginStorage(page, identity),
  );
  const devices = [source];
  try {
    const [
      contacts0,
      contacts1,
      messages0,
      messages1,
      cashu0,
      transactions0,
      identityOwner,
    ] = await hooks.useOwners(
      source.page,
      await laneMnemonics(identity, [
        ["contacts", 0],
        ["contacts", 1],
        ["messages", 0],
        ["messages", 1],
        ["cashu", 0],
        ["transactions", 0],
        ["identity", 0],
      ]),
    );
    const appOwnerId = await hooks.appOwnerId(source.page);
    const contactA = await hooks.createId(source.page);
    const contactB = await hooks.createId(source.page);

    await test.step("seed two lanes per rotating scope the way an older version wrote them", async () => {
      for (const scope of ["contacts", "messages"]) {
        await hooks.upsert(
          source.page,
          "ownerMeta",
          {
            id: await hooks.createId(source.page),
            scope,
            value: JSON.stringify({
              index: 1,
              baseline: 0,
              rotatedAtMs: Date.now(),
            }),
          },
          appOwnerId,
        );
      }
      await hooks.upsert(
        source.page,
        "contact",
        {
          id: contactA,
          name: "Lane zero",
          npub: peer.npub,
          chatLastSeenAtSec: 1_700_000_100,
          archivedAtSec: 1_700_000_200,
        },
        contacts0,
      );
      await hooks.upsert(
        source.page,
        "contact",
        { id: contactB, name: "Lane one" },
        contacts1,
      );
      await hooks.upsert(
        source.page,
        "nostrMessage",
        {
          id: await hooks.createId(source.page),
          contactId: contactA,
          direction: "in",
          content: "Hello from lane zero",
          wrapId: "wrap-lane-0",
          rumorId: "rumor-lane-0",
          pubkey: PUBKEY_HEX,
          createdAtSec: 1_700_000_000,
        },
        messages0,
      );
      await hooks.upsert(
        source.page,
        "nostrMessage",
        {
          id: await hooks.createId(source.page),
          contactId: contactB,
          direction: "out",
          content: "Hello from lane one",
          wrapId: "wrap-lane-1",
          createdAtSec: 1_700_000_010,
        },
        messages1,
      );
      await hooks.upsert(
        source.page,
        "nostrReaction",
        {
          id: await hooks.createId(source.page),
          messageId: "rumor-lane-0",
          reactorPubkey: PUBKEY_HEX,
          emoji: "🔥",
          createdAtSec: 1_700_000_020,
          wrapId: "wrap-reaction",
        },
        messages1,
      );
      await hooks.upsert(
        source.page,
        "cashuProof",
        {
          id: await hooks.createId(source.page),
          mint: "http://localhost:3338",
          unit: "sat",
          keysetId: "00lanezero",
          amount: 8,
          secret: "secret-lane-zero",
          c: `02${PUBKEY_HEX}`,
          state: "spent",
        },
        cashu0,
      );
      await hooks.upsert(
        source.page,
        "transaction",
        {
          id: await hooks.createId(source.page),
          createdAtSec: 1_700_000_000,
          direction: "in",
          status: "ok",
          amount: 21,
          category: "contacts",
        },
        transactions0,
      );
      await hooks.upsert(
        source.page,
        "nostrIdentity",
        {
          id: await hooks.createId(source.page),
          nsec: identity.nsec,
          npub: identity.npub,
          source: "derived",
        },
        identityOwner,
      );
    });

    await test.step("the migration copies every scope into its shard", async () => {
      await rerunMigration(source.page);
      const contacts = await hooks.shardRows(
        source.page,
        "contacts",
        "contact",
      );
      expect(byName(contacts)).toEqual(["Lane one", "Lane zero"]);
      expect(
        contacts.find((row) => row.id === contactA)?.chatLastSeenAtSec,
      ).toBeNull();

      const conversationA = await hooks.conversationIdFor(
        source.page,
        contactA,
      );
      const conversationB = await hooks.conversationIdFor(
        source.page,
        contactB,
      );
      const conversations = await hooks.shardRows(
        source.page,
        "messages",
        "conversation",
      );
      expect(
        conversations.find((row) => row.id === conversationA),
      ).toMatchObject({
        kind: "direct",
        contactId: contactA,
        lastSeenAtSec: 1_700_000_100,
        archivedAtSec: 1_700_000_200,
      });
      expect(
        conversations.find((row) => row.id === conversationB),
      ).toMatchObject({
        contactId: contactB,
        lastSeenAtSec: null,
      });

      const messages = await hooks.shardRows(
        source.page,
        "messages",
        "message",
      );
      expect(
        messages.map((row) => [row.content, row.conversationId]).sort(),
      ).toEqual([
        ["Hello from lane one", conversationB],
        ["Hello from lane zero", conversationA],
      ]);
      const reactions = await hooks.shardRows(
        source.page,
        "messages",
        "reaction",
      );
      expect(reactions).toHaveLength(1);
      expect(reactions[0]).toMatchObject({
        messageId: "rumor-lane-0",
        conversationId: conversationA,
      });

      const proofs = await hooks.shardRows(source.page, "cashu", "cashuProof");
      expect(proofs.map((row) => row.secret)).toEqual(["secret-lane-zero"]);

      const transactions = await hooks.shardRows(
        source.page,
        "transactions",
        "transaction",
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        amount: 21,
        method: "cashu_chat",
      });

      const identities = await hooks.shardRows(
        source.page,
        "identity",
        "nostrIdentity",
      );
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({
        id: await hooks.activeNostrIdentityId(source.page),
        nsec: identity.nsec,
      });

      const pointers = await hooks.shardRows(
        source.page,
        "meta",
        "shardPointer",
      );
      expect(pointers.map((row) => row.scope).sort()).toEqual([
        "cashu",
        "contacts",
        "messages",
        "transactions",
      ]);
      const settings = await hooks.shardRows(source.page, "meta", "setting");
      expect(
        settings.find((row) => row.key === "laneMigration.cutoffMs")?.value,
      ).toMatch(/^\d+$/);
    });

    const follower = await openDevice(browser, baseURL, "fresh", (page) =>
      setSeedLoginStorage(page, identity),
    );
    devices.push(follower);

    await test.step("a device booting fresh receives the shards from the relay", async () => {
      await expect
        .poll(
          () =>
            hooks.shardRows(follower.page, "contacts", "contact").then(byName),
          { timeout: 60_000 },
        )
        .toEqual(["Lane one", "Lane zero"]);
      await expect
        .poll(() =>
          hooks
            .shardRows(follower.page, "messages", "message")
            .then((rows) => rows.length),
        )
        .toBe(2);
      await expect
        .poll(() =>
          hooks
            .shardRows(follower.page, "cashu", "cashuProof")
            .then((rows) => rows.map((row) => row.secret)),
        )
        .toEqual(["secret-lane-zero"]);
      await expect
        .poll(() =>
          hooks
            .shardRows(follower.page, "transactions", "transaction")
            .then((rows) => rows.map((row) => row.method)),
        )
        .toEqual(["cashu_chat"]);
      await testInfo.attach("shards on the fresh device", {
        body: await follower.page.screenshot(),
        contentType: "image/png",
      });
    });

    await test.step("a lane row written after the cutoff is re-ingested on the next boot", async () => {
      await hooks.upsert(
        source.page,
        "contact",
        {
          id: await hooks.createId(source.page),
          name: "Written by an old version",
        },
        contacts1,
      );
      await source.page.reload();
      await expect(source.page.getByLabel("Available balance")).toBeVisible({
        timeout: 60_000,
      });
      await expect
        .poll(() =>
          hooks.shardRows(source.page, "contacts", "contact").then(byName),
        )
        .toEqual(["Lane one", "Lane zero", "Written by an old version"]);
      await expect
        .poll(
          () =>
            hooks
              .shardRows(follower.page, "contacts", "contact")
              .then((rows) => rows.length),
          { timeout: 60_000 },
        )
        .toBe(3);
    });

    for (const device of devices) device.errors.assertClean();
  } finally {
    for (const device of devices) await device.context.close();
  }
});

test("an nsec-only login migrates the app owner's rows", async ({
  browser,
}, testInfo) => {
  const device = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "nsec-only",
    setRandomIdentityStorage,
  );
  try {
    const appOwnerId = await hooks.appOwnerId(device.page);
    const contactId = await hooks.createId(device.page);
    await hooks.upsert(
      device.page,
      "contact",
      {
        id: contactId,
        name: "App owner contact",
        chatLastSeenAtSec: 1_700_000_300,
      },
      appOwnerId,
    );
    await hooks.upsert(
      device.page,
      "nostrMessage",
      {
        id: await hooks.createId(device.page),
        contactId,
        direction: "in",
        content: "Stored in the app owner",
        wrapId: "wrap-app-owner",
        createdAtSec: 1_700_000_000,
      },
      appOwnerId,
    );

    await rerunMigration(device.page);

    expect(
      byName(await hooks.shardRows(device.page, "contacts", "contact")),
    ).toEqual(["App owner contact"]);
    const conversationId = await hooks.conversationIdFor(
      device.page,
      contactId,
    );
    expect(
      await hooks.shardRows(device.page, "messages", "conversation"),
    ).toMatchObject([{ id: conversationId, lastSeenAtSec: 1_700_000_300 }]);
    expect(
      await hooks.shardRows(device.page, "messages", "message"),
    ).toMatchObject([{ content: "Stored in the app owner", conversationId }]);
    device.errors.assertClean();
  } finally {
    await device.context.close();
  }
});
