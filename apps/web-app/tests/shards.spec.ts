import { expect, test, type Browser, type Page } from "@playwright/test";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
import {
  readBalanceSat,
  setBaseStorage,
  MOBILE_VIEWPORT,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

test.use({ actionTimeout: 20_000 });

const ROTATING_SCOPES = ["contacts", "messages", "transactions", "cashu"];

const hooks = {
  /** A scope's active index: the synced pointer row in the app owner. */
  shardIndex: (page: Page, scope: string) =>
    page.evaluate(async (name) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      const pointers = await window.__linkyE2E.shardRows(
        "meta",
        "shardPointer",
      );
      const pointer = pointers.find((row) => row.scope === name);
      return typeof pointer?.index === "number" ? pointer.index : 0;
    }, scope),
  shardOwnerId: (page: Page, scope: string, index: number) =>
    page.evaluate(
      ({ name, at }) => {
        if (!window.__linkyE2E) throw new Error("test hooks missing");
        return window.__linkyE2E.shardOwnerId(String(name), Number(at));
      },
      { name: scope, at: index },
    ),
  shardRows: (page: Page, scope: string, table: string) =>
    page.evaluate(
      ({ name, tableName }) => {
        if (!window.__linkyE2E) throw new Error("test hooks missing");
        return window.__linkyE2E.shardRows(name, tableName);
      },
      { name: scope, tableName: table },
    ),
  syncOwnerIds: (page: Page) =>
    page.evaluate(() => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.syncOwnerIds();
    }),
  forget: (page: Page) =>
    page.evaluate(() => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.forget();
    }),
};

const openDevice = async (
  browser: Browser,
  baseURL: string | undefined,
  identity: SeedIdentity,
  label: string,
) => {
  const context = await browser.newContext({
    baseURL,
    serviceWorkers: "block",
    viewport: MOBILE_VIEWPORT,
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible();
  return { context, page, errors };
};

const rotateFromDebugPage = async (page: Page, scope: string) => {
  await page.goto("/#evolu-current-data");
  await page
    .getByRole("button", { name: `Rotate ${scope} shard`, exact: true })
    .click();
};

test("shard rotations keep old rows, copy edited rows forward, sync new writes, and forget old message shards on a fresh device", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const peer = await createSeedIdentity();
  const baseURL = testInfo.project.use.baseURL;
  const source = await openDevice(browser, baseURL, identity, "source");
  const follower = await openDevice(browser, baseURL, identity, "follower");
  const devices = [source, follower];
  const closers = [source.context, follower.context];
  try {
    const contactId = await addContactByNpub(source.page, peer.npub);
    await source.page
      .locator('[data-guide="chat-input"]')
      .fill("Before shard rotation");
    await source.page.locator('[data-guide="chat-send"]').click();
    await source.page
      .locator('[data-guide="chat-input"]')
      .fill("Also before rotation");
    await source.page.locator('[data-guide="chat-send"]').click();
    await follower.page.goto(`/#chat/${contactId}`);
    for (const text of ["Before shard rotation", "Also before rotation"])
      await expect(
        follower.page.locator(".chat-bubble").filter({ hasText: text }),
      ).toBeVisible();
    await topUp(source.page, 32);
    await expect.poll(() => readBalanceSat(source.page)).toBe(32);
    for (const device of devices) {
      await device.page.goto("/#wallet/transactions");
      await expect(device.page.locator(".transaction-card")).toHaveCount(1);
    }

    await test.step("rotate each scope from the debug page and observe its pointer on the other device", async () => {
      for (const scope of ROTATING_SCOPES) {
        await rotateFromDebugPage(source.page, scope);
        for (const device of devices) {
          await expect.poll(() => hooks.shardIndex(device.page, scope)).toBe(1);
        }
      }
    });

    await test.step("an edit of a row born in shard 0 lands as a copy in shard 1 on the other device", async () => {
      await source.page.goto(`/#contact/${contactId}/edit`);
      await source.page
        .locator(".form-grid input")
        .first()
        .fill("Updated after rotation");
      await source.page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      const contactsShard1 = await hooks.shardOwnerId(
        follower.page,
        "contacts",
        1,
      );
      await expect
        .poll(async () => {
          const rows = await hooks.shardRows(
            follower.page,
            "contacts",
            "contact",
          );
          const row = rows.find((entry) => entry.id === contactId);
          return row ? { name: row.name, ownerId: row.ownerId } : null;
        })
        .toEqual({ name: "Updated after rotation", ownerId: contactsShard1 });
      const nextPeer = await createSeedIdentity();
      await addContactByNpub(source.page, nextPeer.npub);
      await follower.page.goto("/#contacts");
      await expect(
        follower.page.locator('[data-guide="contact-card"]'),
      ).toHaveCount(2);
    });

    await test.step("new messages and topups coexist with shard 0 history", async () => {
      await source.page.goto(`/#chat/${contactId}`);
      await source.page
        .locator('[data-guide="chat-input"]')
        .fill("After shard rotation");
      await source.page.locator('[data-guide="chat-send"]').click();
      await topUp(source.page, 16);
      await expect.poll(() => readBalanceSat(source.page)).toBe(48);
      for (const device of devices) {
        await device.page.goto("/#wallet/transactions");
        await expect(device.page.locator(".transaction-card")).toHaveCount(2);
      }
      for (const device of devices) {
        await device.page.reload();
        await device.page.goto("/#contacts");
        await expect(
          device.page.locator('[data-guide="contact-card"]'),
        ).toHaveCount(2);
        await device.page.goto(`/#chat/${contactId}`);
        for (const text of [
          "Before shard rotation",
          "Also before rotation",
          "After shard rotation",
        ])
          await expect(
            device.page.locator(".chat-bubble").filter({ hasText: text }),
          ).toBeVisible();
        await device.page.goto("/#wallet/transactions");
        await expect(device.page.locator(".transaction-card")).toHaveCount(2);
        device.errors.assertClean();
      }
    });

    await test.step("an edit of a shard 0 message lands as a copy in shard 1 on the other device", async () => {
      await source.page.goto(`/#chat/${contactId}`);
      await source.page
        .locator(".chat-bubble")
        .filter({ hasText: "Before shard rotation" })
        .click({ button: "right" });
      await source.page
        .getByRole("menu")
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await source.page
        .locator('[data-guide="chat-input"]')
        .fill("Before shard rotation, edited");
      await source.page
        .getByRole("button", { name: "Save", exact: true })
        .click();
      const messagesShard1 = await hooks.shardOwnerId(
        follower.page,
        "messages",
        1,
      );
      await expect
        .poll(async () => {
          const rows = await hooks.shardRows(
            follower.page,
            "messages",
            "message",
          );
          const row = rows.find(
            (entry) => entry.content === "Before shard rotation, edited",
          );
          return row ? { isEdited: row.isEdited, ownerId: row.ownerId } : null;
        })
        .toEqual({ isEdited: "1", ownerId: messagesShard1 });
      await follower.page.goto(`/#chat/${contactId}`);
      await expect(
        follower.page
          .locator(".chat-message")
          .filter({ hasText: "Before shard rotation, edited" }),
      ).toContainText("edited");
    });

    await test.step("a fresh device subscribes only the newest message shards", async () => {
      for (const index of [2, 3, 4]) {
        await rotateFromDebugPage(source.page, "messages");
        for (const device of devices) {
          await expect
            .poll(() => hooks.shardIndex(device.page, "messages"))
            .toBe(index);
        }
      }
      const messagesShard0 = await hooks.shardOwnerId(
        source.page,
        "messages",
        0,
      );
      expect(await hooks.forget(source.page)).toEqual([
        { scope: "messages", index: 0, deleted: false },
      ]);
      expect(await hooks.syncOwnerIds(source.page)).not.toContain(
        messagesShard0,
      );

      const fresh = await openDevice(browser, baseURL, identity, "fresh");
      closers.push(fresh.context);
      // The edited message was copied into shard 1; the untouched one stayed
      // in shard 0, which a fresh device never subscribes.
      await expect
        .poll(async () => {
          const rows = await hooks.shardRows(fresh.page, "messages", "message");
          return rows.map((row) => row.content).sort();
        })
        .toEqual(["After shard rotation", "Before shard rotation, edited"]);
      expect(await hooks.syncOwnerIds(fresh.page)).not.toContain(
        messagesShard0,
      );
      await fresh.page.goto("/#contacts");
      await expect(
        fresh.page.locator('[data-guide="contact-card"]'),
      ).toHaveCount(2);
      await fresh.page.goto(`/#chat/${contactId}`);
      for (const text of [
        "After shard rotation",
        "Before shard rotation, edited",
      ])
        await expect(
          fresh.page.locator(".chat-bubble").filter({ hasText: text }),
        ).toBeVisible();
      await expect(
        fresh.page
          .locator(".chat-bubble")
          .filter({ hasText: "Also before rotation" }),
      ).toHaveCount(0);
      await fresh.page.goto("/#wallet/transactions");
      await expect(fresh.page.locator(".transaction-card")).toHaveCount(2);
      await fresh.page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(fresh.page)).toBe(48);
      await testInfo.attach("fresh device after forgetting shard 0", {
        body: await fresh.page.screenshot(),
        contentType: "image/png",
      });
      fresh.errors.assertClean();
    });
  } finally {
    for (const context of closers) await context.close();
  }
});

test("natural message rotations retain local history until forget and sync only newest four to a fresh device", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const peer = await createSeedIdentity();
  const source = await openDevice(
    browser,
    testInfo.project.use.baseURL,
    identity,
    "A",
  );
  const closers = [source.context];
  try {
    await source.page.evaluate(() =>
      localStorage.setItem("linky.inspector_enabled", "true"),
    );
    await source.page.reload();
    const contactId = await addContactByNpub(source.page, peer.npub);
    await topUp(source.page, 32);
    await expect.poll(() => readBalanceSat(source.page)).toBe(32);
    const proofs = await hooks.shardRows(source.page, "cashu", "cashuProof");
    expect(proofs.length).toBeGreaterThan(0);
    const contacts = await hooks.shardRows(source.page, "contacts", "contact");
    await source.page.goto(`/#chat/${contactId}`);
    await source.page.evaluate(() =>
      window.__linkyE2E?.setMessagesRotation(true),
    );
    const send = async (text: string) => {
      await source.page.locator('[data-guide="chat-input"]').fill(text);
      await source.page.locator('[data-guide="chat-send"]').click();
      await expect
        .poll(async () =>
          (await hooks.shardRows(source.page, "messages", "message")).some(
            (row) => row.content === text && row.rumorId,
          ),
        )
        .toBeTruthy();
    };
    await test.step("repository writes cross the real mutation threshold four times", async () => {
      for (
        let count = 0;
        count < 100 && (await hooks.shardIndex(source.page, "messages")) < 4;
        count += 1
      )
        await send(`Natural rotation message ${count}`);
      await expect
        .poll(() => hooks.shardIndex(source.page, "messages"))
        .toBe(4);
      await source.page.evaluate(() =>
        window.__linkyE2E?.setMessagesRotation(false),
      );
    });
    const oldOwner = await hooks.shardOwnerId(source.page, "messages", 0);
    expect(await hooks.syncOwnerIds(source.page)).toContain(oldOwner);
    const before = await hooks.shardRows(source.page, "messages", "message");
    expect(before.some((row) => row.ownerId === oldOwner)).toBe(true);
    await source.page.reload();
    await expect(
      source.page.locator('[data-guide="chat-input"]'),
    ).toBeVisible();
    await expect
      .poll(() => hooks.syncOwnerIds(source.page))
      .toContain(oldOwner);

    await test.step("a new message advances the cursor and copies the active conversation into shard four", async () => {
      const beforeCursor = (
        await hooks.shardRows(source.page, "messages", "conversation")
      ).find((row) => row.contactId === contactId)?.lastSeenAtSec;
      await expect
        .poll(() => Math.floor(Date.now() / 1000))
        .toBeGreaterThan(Number(beforeCursor ?? 0));
      const sender = await openDevice(
        browser,
        testInfo.project.use.baseURL,
        peer,
        "C",
      );
      closers.push(sender.context);
      await addContactByNpub(sender.page, identity.npub);
      await sender.page
        .locator('[data-guide="chat-input"]')
        .fill("Active chat after natural rotation");
      await sender.page.locator('[data-guide="chat-send"]').click();
      await source.page.bringToFront();
      await expect(
        source.page
          .locator(".chat-bubble")
          .filter({ hasText: "Active chat after natural rotation" }),
      ).toBeVisible();
      const newestOwner = await hooks.shardOwnerId(source.page, "messages", 4);
      await expect
        .poll(async () => {
          const row = (
            await hooks.shardRows(source.page, "messages", "conversation")
          ).find((entry) => entry.contactId === contactId);
          return (
            row &&
            row.ownerId === newestOwner &&
            Number(row.lastSeenAtSec) > Number(beforeCursor ?? 0)
          );
        })
        .toBe(true);
    });

    const allMessages = await hooks.shardRows(
      source.page,
      "messages",
      "message",
    );
    const forgottenContent = allMessages.find(
      (row) => row.ownerId === oldOwner,
    )?.content;
    if (typeof forgottenContent !== "string")
      throw new Error("no old-shard message to forget");
    const expectedIds = allMessages
      .filter((row) => row.ownerId !== oldOwner)
      .map((row) => row.id)
      .sort();
    const fresh = await openDevice(
      browser,
      testInfo.project.use.baseURL,
      identity,
      "B",
    );
    closers.push(fresh.context);
    await expect.poll(() => hooks.shardIndex(fresh.page, "messages")).toBe(4);
    await expect
      .poll(async () =>
        (await hooks.shardRows(fresh.page, "messages", "message"))
          .map((row) => row.id)
          .sort(),
      )
      .toEqual(expectedIds);
    expect(await hooks.syncOwnerIds(fresh.page)).not.toContain(oldOwner);
    for (const index of [1, 2, 3, 4])
      expect(await hooks.syncOwnerIds(fresh.page)).toContain(
        await hooks.shardOwnerId(fresh.page, "messages", index),
      );
    await expect
      .poll(async () =>
        (await hooks.shardRows(fresh.page, "contacts", "contact"))
          .map((row) => row.id)
          .sort(),
      )
      .toEqual(contacts.map((row) => row.id).sort());
    await expect
      .poll(async () =>
        (await hooks.shardRows(fresh.page, "cashu", "cashuProof"))
          .map((row) => row.id)
          .sort(),
      )
      .toEqual(proofs.map((row) => row.id).sort());
    await expect.poll(() => readBalanceSat(fresh.page)).toBe(32);
    await expect
      .poll(
        async () =>
          (await hooks.shardRows(fresh.page, "messages", "conversation")).find(
            (row) => row.contactId === contactId,
          )?.ownerId,
      )
      .toBe(await hooks.shardOwnerId(fresh.page, "messages", 4));

    await test.step("the settings action forgets only old chat shards and survives reload", async () => {
      await expect(
        source.page.getByText(forgottenContent, { exact: true }),
      ).toBeVisible();
      await source.page.goto("/#advanced/chat-storage");
      await expect(
        source.page
          .locator(".settings-row")
          .filter({ hasText: "Chat shards created" }),
      ).toHaveText("Chat shards created5");
      await expect(
        source.page
          .locator(".settings-row")
          .filter({ hasText: "Subscribed on this device" }),
      ).toHaveText("Subscribed on this device5");
      await source.page
        .getByRole("button", { name: "Forget old chat shards", exact: true })
        .click();
      await expect(source.page.getByRole("status")).toHaveText(
        "Old chat shards forgotten on this device.",
      );
      await expect(
        source.page
          .locator(".settings-row")
          .filter({ hasText: "Subscribed on this device" }),
      ).toHaveText("Subscribed on this device4");
      await expect(
        source.page.getByRole("button", {
          name: "Forget old chat shards",
          exact: true,
        }),
      ).toBeDisabled();
      await testInfo.attach("chat storage after forget", {
        body: await source.page.screenshot(),
        contentType: "image/png",
      });
      await source.page.goto(`/#chat/${contactId}`);
      await expect(
        source.page.getByText(forgottenContent, { exact: true }),
      ).toHaveCount(0);
      await expect(
        source.page
          .locator(".chat-bubble")
          .filter({ hasText: "Active chat after natural rotation" }),
      ).toBeVisible();
      await source.page.goto("/#advanced/inspector/timeline");
      const forgottenRow = source.page
        .locator(".timeline-row")
        .filter({ hasText: "ShardsForgotten" });
      await expect(forgottenRow).toHaveCount(1);
      await forgottenRow.click();
      const detail = source.page.getByRole("complementary", {
        name: "Row detail",
      });
      await expect(detail.locator(".link-value")).toContainText(oldOwner);
      await expect(
        detail
          .locator(".related-row")
          .filter({ hasText: "ShardsSubscribed" })
          .first(),
      ).toBeVisible();
      await expect(detail.locator("pre")).toContainText('"deleted": false');
      await source.page.reload();
      await expect(source.page.locator(".timeline")).toBeVisible();
      await expect
        .poll(async () =>
          (await hooks.shardRows(source.page, "messages", "message"))
            .map((row) => row.id)
            .sort(),
        )
        .toEqual(expectedIds);
      expect(await hooks.syncOwnerIds(source.page)).not.toContain(oldOwner);
      await source.page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(source.page)).toBe(32);
    });
    source.errors.assertClean();
    fresh.errors.assertClean();
  } finally {
    for (const context of closers) await context.close();
  }
});
