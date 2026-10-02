import { expect, test, type Browser, type Page } from "@playwright/test";
import type { OwnerRole } from "@linky-fit/identity";
import { shardPointerId } from "@linky-fit/linksync";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
import { deriveEvoluOwnerMnemonicFromSlip39 } from "../src/utils/slip39Nostr";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { watchAppErrors } from "./helpers/diagnostics";
import {
  holdEvoluRelay,
  releaseEvoluRelay,
  startSilentEvoluRelay,
} from "./helpers/evoluRelay";
import {
  createSeedIdentity,
  setRandomIdentityStorage,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { shardOwnerId } from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { EVOLU_RELAY_URL } from "./helpers/stack";
import { mintUrl } from "../../../packages/linkshu/tests/integration/helpers";

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
          mint: mintUrl,
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
      expect(contacts.find((row) => row.id === contactA)).toMatchObject({
        chatLastSeenAtSec: null,
        archivedAtSec: 1_700_000_200,
      });

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

      expect(
        await hooks.shardRows(source.page, "meta", "shardPointer"),
      ).toEqual([]);
      const settings = await hooks.shardRows(source.page, "meta", "setting");
      expect(
        settings.find((row) => row.key === "laneMigration.cutoffMs"),
      ).toBeUndefined();
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

test("spent shard proofs mark existing legacy copies spent during the grace period", async ({
  browser,
}, testInfo) => {
  const device = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "spent compatibility",
    async (page) => {
      await setRandomIdentityStorage(page);
      await page.addInitScript(() =>
        localStorage.setItem("linky.inspector_enabled", "true"),
      );
    },
  );
  try {
    const owner = await hooks.appOwnerId(device.page);
    const id = await hooks.createId(device.page);
    const proof = {
      id,
      mint: mintUrl,
      unit: "sat",
      keysetId: "00legacy",
      amount: 8,
      secret: "legacy-compatibility-proof",
      c: `02${PUBKEY_HEX}`,
      state: "held",
    };
    await hooks.upsert(device.page, "cashuProof", proof, owner);
    await device.page.reload();
    await expect(device.page.getByLabel("Available balance")).toBeVisible();
    const shard = await device.page.evaluate(async () => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.shardOwnerId("cashu", 0);
    });
    await hooks.upsert(
      device.page,
      "cashuProof",
      { ...proof, state: "spent" },
      shard,
    );
    await expect
      .poll(() =>
        device.page.evaluate(
          async ({ owner, id }) => {
            if (!window.__linkyE2E) throw new Error("test hooks missing");
            const rows = await window.__linkyE2E.ownerProofRows(owner);
            return rows.find((row) => row.id === id)?.state;
          },
          { owner, id },
        ),
      )
      .toBe("spent");
    await device.page.goto("/#advanced/inspector/timeline");
    await expect(
      device.page.getByText(/Marked 1 legacy proofs spent/).first(),
    ).toBeVisible();
    await device.page.reload();
    await device.page.goto("/#wallet");
    await expect(device.page.getByLabel("Available balance")).toBeVisible();
    await expect
      .poll(() =>
        hooks
          .shardRows(device.page, "cashu", "cashuProof")
          .then((rows) => rows.find((row) => row.id === id)?.state),
      )
      .toBe("spent");
    device.errors.assertClean();
  } finally {
    await device.context.close();
  }
});

test("a fresh device ingests late relay rows and discovers later legacy lanes without reloading", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const writer = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "legacy writer",
    setRandomIdentityStorage,
  );
  const reader = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "fresh legacy reader",
    (page) => setSeedLoginStorage(page, identity),
  );
  try {
    const [meta, contacts2] = await hooks.useOwners(writer.page, [
      identity.evoluMnemonic,
      ...(await laneMnemonics(identity, [["contacts", 2]])),
    ]);
    await hooks.upsert(
      writer.page,
      "ownerMeta",
      {
        id: await hooks.createId(writer.page),
        scope: "contacts",
        value: JSON.stringify({ index: 2 }),
      },
      meta,
    );
    await hooks.upsert(
      writer.page,
      "contact",
      { id: await hooks.createId(writer.page), name: "Late legacy lane two" },
      contacts2,
    );
    await expect
      .poll(() =>
        hooks.shardRows(reader.page, "contacts", "contact").then(byName),
      )
      .toEqual(["Late legacy lane two"]);
    await reader.page.reload();
    await expect(reader.page.getByLabel("Available balance")).toBeVisible();
    await expect
      .poll(() =>
        hooks.shardRows(reader.page, "contacts", "contact").then(byName),
      )
      .toEqual(["Late legacy lane two"]);
    writer.errors.assertClean();
    reader.errors.assertClean();
  } finally {
    await writer.context.close();
    await reader.context.close();
  }
});

test("a restored device leaves the pointers of an account that rotated past shard 0", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const baseURL = testInfo.project.use.baseURL;
  const login = (page: Page) => setSeedLoginStorage(page, identity);
  const rotated = await openDevice(browser, baseURL, "rotated", login);
  const devices = [rotated];
  try {
    const appOwnerId = await hooks.appOwnerId(rotated.page);
    await hooks.upsert(
      rotated.page,
      "shardPointer",
      {
        id: shardPointerId("contacts"),
        scope: "contacts",
        index: 2,
        rotatedAtMs: Date.now(),
      },
      appOwnerId,
    );
    const contactsIndex = (page: Page) =>
      hooks
        .shardRows(page, "meta", "shardPointer")
        .then((rows) => rows.find((row) => row.scope === "contacts")?.index);

    // The restored device migrates while its Evolu server is still unreachable, as on a slow relay.
    const restored = await openDevice(browser, baseURL, "restored", (page) =>
      login(page).then(() =>
        page.addInitScript((relay) => {
          if (sessionStorage.getItem("e2e.evolu-released") === "1") return;
          localStorage.setItem(
            "linky.evoluServers.disabled.v1",
            JSON.stringify([relay]),
          );
        }, EVOLU_RELAY_URL),
      ),
    );
    devices.push(restored);
    await expect
      .poll(() =>
        restored.page.evaluate((flag) => localStorage.getItem(flag), DONE_FLAG),
      )
      .toBe("1");
    await restored.page.evaluate(() => {
      sessionStorage.setItem("e2e.evolu-released", "1");
      localStorage.removeItem("linky.evoluServers.disabled.v1");
    });
    await restored.page.reload();
    await expect(restored.page.getByLabel("Available balance")).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => contactsIndex(restored.page), { timeout: 60_000 })
      .toBe(2);

    // The restored device's earlier app-owner writes reach the rotated device no later than this one.
    const marker = await hooks.createId(restored.page);
    await hooks.upsert(
      restored.page,
      "setting",
      { id: marker, key: "e2e.marker", value: "1" },
      appOwnerId,
    );
    await expect
      .poll(
        () =>
          hooks
            .shardRows(rotated.page, "meta", "setting")
            .then((rows) => rows.some((row) => row.id === marker)),
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(await contactsIndex(rotated.page)).toBe(2);
    expect(await contactsIndex(restored.page)).toBe(2);
    for (const device of devices) device.errors.assertClean();
  } finally {
    for (const device of devices) await device.context.close();
  }
});

test("a device moves a contacts pointer that was reset to 0 back up to the newest shard with rows", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const device = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "reset pointer",
    async (page) => {
      await setSeedLoginStorage(page, identity);
      await page.addInitScript(() =>
        localStorage.setItem("linky.inspector_enabled", "true"),
      );
    },
  );
  const { page } = device;
  try {
    const appOwnerId = await hooks.appOwnerId(page);
    const writePointer = (row: Row) =>
      hooks.upsert(
        page,
        "shardPointer",
        { id: shardPointerId("contacts"), scope: "contacts", ...row },
        appOwnerId,
      );
    const contactsIndex = () =>
      hooks
        .shardRows(page, "meta", "shardPointer")
        .then((rows) => rows.find((row) => row.scope === "contacts")?.index);
    const contacts = () =>
      hooks.shardRows(page, "contacts", "contact").then(byName);

    await writePointer({ index: 2, rotatedAtMs: Date.now() });
    for (const index of [1, 2]) {
      await hooks.upsert(
        page,
        "contact",
        { id: await hooks.createId(page), name: `Shard ${index}` },
        await shardOwnerId(page, "contacts", index),
      );
    }
    await expect.poll(contacts).toEqual(["Shard 1", "Shard 2"]);

    // What an early seed restore wrote: only the index, newer than the rotation.
    await writePointer({ index: 0 });
    await expect.poll(contacts).toEqual([]);

    await page.reload();
    await expect(page.getByLabel("Available balance")).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(contactsIndex, { timeout: 60_000 }).toBe(2);
    await expect.poll(contacts).toEqual(["Shard 1", "Shard 2"]);
    await page.goto("/#advanced/inspector/timeline");
    await expect(
      page
        .getByText("contacts shard pointer moved back up from index 0 to 2")
        .first(),
    ).toBeVisible();
    device.errors.assertClean();
  } finally {
    await device.context.close();
  }
});

test("lane rows wait for the Evolu relay, and the migrating screen gives way after its bound", async ({
  browser,
}, testInfo) => {
  const device = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    "silent relay",
    setRandomIdentityStorage,
  );
  const { context, page } = device;
  const relay = await startSilentEvoluRelay();
  const doneFlag = () =>
    page.evaluate((flag) => localStorage.getItem(flag), DONE_FLAG);
  const shardContacts = async () =>
    byName(await hooks.shardRows(page, "contacts", "contact"));
  const removeDoneFlagAndReload = async () => {
    await page.evaluate((flag) => localStorage.removeItem(flag), DONE_FLAG);
    await page.reload();
  };
  const migrating = page.getByRole("status").filter({
    hasText: "Migrating data",
  });
  // Shown only while the account is not hydrated, and lanes are ingested only after hydration.
  const waitingForRelay = page.getByRole("status").filter({
    hasText: "Waiting for the Evolu relay",
  });
  try {
    await holdEvoluRelay(page, relay);
    await removeDoneFlagAndReload();
    await expect(page.getByLabel("Available balance")).toBeVisible();
    await expect.poll(doneFlag).toBe("1");

    await test.step("a lane row written while the relay is silent is not ingested yet", async () => {
      await hooks.upsert(
        page,
        "contact",
        { id: await hooks.createId(page), name: "Held contact" },
        await hooks.appOwnerId(page),
      );
      await expect(waitingForRelay).toBeVisible();
      expect(await shardContacts()).toEqual([]);
    });

    await test.step("with a silent relay, the screen gives way after its bound and says what it waits for", async () => {
      await removeDoneFlagAndReload();
      await expect(migrating).toBeVisible();
      await expect(page.getByLabel("Available balance")).toBeVisible({
        timeout: 30_000,
      });
      await expect(waitingForRelay).toBeVisible();
      expect(await doneFlag()).toBeNull();
      expect(await shardContacts()).toEqual([]);
    });

    await test.step("with a relay that answers, the lane row is ingested", async () => {
      await releaseEvoluRelay(page);
      await expect.poll(doneFlag).toBe("1");
      await expect.poll(shardContacts).toEqual(["Held contact"]);
    });
    device.errors.assertClean();
  } finally {
    await context.close();
    await relay.close();
  }
});
