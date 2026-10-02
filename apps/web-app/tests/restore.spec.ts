// A seed restore on a clean browser, after the account archived a chat long
// ago, rotated its message shards past that archive, read part of a chat,
// heard from unknown senders and blocked one of them.
import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../src/utils/constants";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import {
  holdEvoluRelay,
  releaseEvoluRelay,
  startSilentEvoluRelay,
} from "./helpers/evoluRelay";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import {
  isHydrated,
  shardIndexes,
  shardOwnerId,
  shardRows,
  syncOwnerIds,
} from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import {
  npubToHex,
  sendDirectMessage,
  waitForMuteListOnRelay,
  watchNostrInbox,
} from "./helpers/relay";

test.use({ actionTimeout: 20_000 });

const BACKDATE_MARGIN_SEC = 2 * 24 * 60 * 60;
const ROTATIONS_PAST_ARCHIVE = 4;
const Y_TEXTS = ["Y one", "Y two", "Y three"] as const;

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
  return { context, errors, page };
};

const card = (page: Page, contactId: string) =>
  page.locator(
    `[data-guide='contact-card'][data-guide-contact-id='${contactId}']`,
  );

const unknownId = (identity: SeedIdentity) =>
  `${UNKNOWN_CONTACT_ID_PREFIX}${npubToHex(identity.npub)}`;

/** The open chat shows exactly these messages, each once, in order. */
const expectBubbles = (page: Page, texts: ReadonlyArray<string>) =>
  expect(page.locator(".chat-bubble")).toHaveText(
    texts.map((text) => new RegExp(text)),
  );

const sendInOpenChat = async (page: Page, text: string) => {
  await page.locator('[data-guide="chat-input"]').fill(text);
  await page.locator('[data-guide="chat-send"]').click();
  await expect
    .poll(async () =>
      (await shardRows(page, "messages", "message")).some(
        (row) => row.content === text,
      ),
    )
    .toBe(true);
};

const contactArchivedAt = async (page: Page, contactId: string) =>
  (await shardRows(page, "contacts", "contact")).find(
    (row) => row.id === contactId,
  )?.archivedAtSec ?? null;

/** Whether each chat shows the unread dot; archived ones are read under the Archive filter. */
const unreadDots = async (
  page: Page,
  ids: { archived: string; listed: ReadonlyArray<string> },
) => {
  await page.goto("/#contacts");
  const dots: Record<string, boolean> = {};
  for (const id of ids.listed) {
    await expect(card(page, id)).toBeVisible();
    dots[id] =
      (await card(page, id).locator(".contact-unread-dot").count()) > 0;
  }
  await expect(card(page, ids.archived)).toHaveCount(0);
  const archiveFilter = page.getByRole("button", {
    name: "Archive",
    exact: true,
  });
  if (!(await archiveFilter.isVisible()))
    await page
      .getByRole("button", { name: "Search and filter contacts", exact: true })
      .click();
  await archiveFilter.click();
  await expect(card(page, ids.archived)).toBeVisible();
  dots[ids.archived] =
    (await card(page, ids.archived).locator(".contact-unread-dot").count()) > 0;
  await archiveFilter.click();
  return dots;
};

const syncedInboxCursor = async (page: Page): Promise<number | null> => {
  const row = (await shardRows(page, "meta", "setting")).find((setting) =>
    String(setting.key).startsWith("inboxCursor/"),
  );
  return row === undefined ? null : Number(row.value);
};

test("a seed restore keeps the account's archive, blocks and history intact", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const [account, x, y, z, w, filler] = await Promise.all(
    Array.from({ length: 6 }, () => createSeedIdentity()),
  );
  const a = await openDevice(browser, baseURL, account, "A");
  const devices = [a];
  const heldRelay = await startSilentEvoluRelay();
  try {
    const aInboxReady = watchNostrInbox(a.page, account.npub);
    await a.page.goto("/#wallet");
    await aInboxReady();

    const xId =
      await test.step("A chats with X, then archives the chat", async () => {
        const id = await addContactByNpub(a.page, x.npub);
        await sendInOpenChat(a.page, "Hi X");
        await sendDirectMessage(x.nsec, account.npub, "Hi from X");
        await expect(
          a.page.locator(".chat-bubble").filter({ hasText: "Hi from X" }),
        ).toBeVisible();
        await a.page.goto(`/#contact/${id}/edit`);
        await a.page
          .getByRole("button", { name: "Archive contact", exact: true })
          .click();
        await expect.poll(() => contactArchivedAt(a.page, id)).not.toBeNull();
        return id;
      });
    const archivedAtSec = await contactArchivedAt(a.page, xId);

    await test.step("the messages scope rotates four shards past the archive", async () => {
      const fillerId = await addContactByNpub(a.page, filler.npub);
      for (let index = 1; index <= ROTATIONS_PAST_ARCHIVE; index += 1) {
        await a.page.goto("/#evolu-current-data");
        await a.page
          .getByRole("button", { name: "Rotate messages shard", exact: true })
          .click();
        await expect
          .poll(async () => (await shardIndexes(a.page)).messages)
          .toBe(index);
        // A rotation leaves no empty shard behind in real use.
        await a.page.goto(`/#chat/${fillerId}`);
        await sendInOpenChat(a.page, `Filler ${index}`);
      }
    });

    const yId =
      await test.step("A reads Y's first messages but not the last", async () => {
        const id = await addContactByNpub(a.page, y.npub);
        const nowSec = Math.floor(Date.now() / 1000);
        await sendDirectMessage(y.nsec, account.npub, Y_TEXTS[0], nowSec - 2);
        await sendDirectMessage(y.nsec, account.npub, Y_TEXTS[1], nowSec - 1);
        await expectBubbles(a.page, Y_TEXTS.slice(0, 2));
        await expect
          .poll(
            async () =>
              (await shardRows(a.page, "messages", "conversation")).find(
                (row) => row.contactId === id,
              )?.lastSeenAtSec,
          )
          .toBe(nowSec - 1);
        await a.page.goto("/#contacts");
        await sendDirectMessage(y.nsec, account.npub, Y_TEXTS[2], nowSec + 1);
        await expect(
          card(a.page, id).locator(".contact-unread-dot"),
        ).toHaveCount(1);
        return id;
      });

    await test.step("Z writes as an unknown sender", async () => {
      await sendDirectMessage(z.nsec, account.npub, "Hi from Z");
      await expect(card(a.page, unknownId(z))).toBeVisible();
    });

    await test.step("A blocks W after W wrote, and publishes the mute list", async () => {
      await sendDirectMessage(w.nsec, account.npub, "Hi from W");
      await card(a.page, unknownId(w)).click();
      a.page.once("dialog", (dialog) => void dialog.accept());
      await a.page.getByRole("button", { name: "Block", exact: true }).click();
      await expect(card(a.page, unknownId(w))).toHaveCount(0);
      await waitForMuteListOnRelay(account.npub, npubToHex(w.npub));
    });

    const listedIds = [yId, unknownId(z)];
    const aDots = await unreadDots(a.page, {
      archived: xId,
      listed: listedIds,
    });
    expect(aDots).toEqual({ [xId]: false, [yId]: true, [unknownId(z)]: true });
    const aPointers = await shardIndexes(a.page);
    const forgottenOwner = await shardOwnerId(a.page, "messages", 0);

    const cursor = await test.step("A's inbox cursor is synced", async () => {
      await expect.poll(() => syncedInboxCursor(a.page)).not.toBeNull();
      return Number(await syncedInboxCursor(a.page));
    });

    const b = await openDevice(browser, baseURL, account, "B");
    devices.push(b);
    const awaitingKey = `linky.shards.awaitingFirstHydration.${appOwnerFromMnemonic(account.evoluMnemonic)?.id}`;
    const awaitingFirstHydration = () =>
      b.page.evaluate((key) => localStorage.getItem(key), awaitingKey);
    // The seed restore screen leaves this marker; set it once, before the first load.
    await b.page.addInitScript((key) => {
      if (sessionStorage.getItem("restore-marked") !== null) return;
      sessionStorage.setItem("restore-marked", "1");
      localStorage.setItem(key, "1");
    }, awaitingKey);
    await holdEvoluRelay(b.page, heldRelay);
    const giftWrapRequests: string[] = [];
    b.page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        const frame = String(payload);
        if (frame.startsWith('["REQ"') && frame.includes("1059"))
          giftWrapRequests.push(frame);
      }),
    );
    const bInboxReady = watchNostrInbox(b.page, account.npub);

    await test.step("B restores the seed and waits for the Evolu relay before anything else", async () => {
      await b.page.goto("/#wallet");
      await expect(b.page.getByLabel("Available balance")).toBeVisible({
        timeout: 60_000,
      });
      // B has asked the Evolu relay for the account's data and waits for the answer.
      await expect.poll(heldRelay.hasReceivedRequest).toBe(true);
      expect(await isHydrated(b.page)).toBe(false);
      expect(await awaitingFirstHydration()).toBe("1");
      expect(giftWrapRequests).toEqual([]);
      for (const [scope, table] of [
        ["messages", "conversation"],
        ["messages", "message"],
        ["unknownSenders", "unknownSenderMessage"],
      ] as const)
        expect(await shardRows(b.page, scope, table)).toEqual([]);
    });

    await releaseEvoluRelay(b.page);
    await bInboxReady();
    expect(await isHydrated(b.page)).toBe(true);
    expect(await awaitingFirstHydration()).toBeNull();

    await test.step("B keeps X archived though its conversation sits in a forgotten shard", async () => {
      expect(await syncOwnerIds(b.page)).not.toContain(forgottenOwner);
      expect(await contactArchivedAt(b.page, xId)).toBe(archivedAtSec);
    });

    await test.step("B marks the same chats unread as A before opening any", async () => {
      await expect
        .poll(async () =>
          (await shardRows(b.page, "messages", "message"))
            .filter((row) => Y_TEXTS.some((text) => text === row.content))
            .map((row) => row.content)
            .sort(),
        )
        .toEqual([...Y_TEXTS].sort());
      expect(
        await unreadDots(b.page, { archived: xId, listed: listedIds }),
      ).toEqual(aDots);
    });

    await test.step("B shows Y's messages once each", async () => {
      await b.page.goto(`/#chat/${yId}`);
      await expectBubbles(b.page, Y_TEXTS);
    });

    await test.step("B shows Z as an unknown sender and nothing from W", async () => {
      await b.page.goto("/#contacts");
      await card(b.page, unknownId(z)).click();
      await expectBubbles(b.page, ["Hi from Z"]);
      await b.page.goto("/#contacts");
      await expect(card(b.page, unknownId(w))).toHaveCount(0);
      expect(
        await b.page.evaluate(() =>
          localStorage.getItem("linky.blocked_nostr_pubkeys.v1"),
        ),
      ).toContain(npubToHex(w.npub));
      const fromW = (
        await shardRows(b.page, "unknownSenders", "unknownSenderMessage")
      ).filter((row) => row.peerPubkey === npubToHex(w.npub));
      expect(fromW).toEqual([]);
    });

    await test.step("B's inbox started from A's synced cursor minus the backdate margin", async () => {
      const sinces = giftWrapRequests
        .map((frame): unknown => JSON.parse(frame)[2].since)
        .filter((since) => typeof since === "number");
      expect(sinces.length).toBeGreaterThan(0);
      expect(Math.min(...sinces)).toBe(cursor - BACKDATE_MARGIN_SEC);
    });

    await test.step("B's Y chat gained no copies while it caught up", async () => {
      await b.page.goto(`/#chat/${yId}`);
      await expectBubbles(b.page, Y_TEXTS);
      expect(await shardIndexes(b.page)).toEqual(aPointers);
    });

    await test.step("back on A nothing was unarchived or regressed", async () => {
      await a.page.reload();
      await expect.poll(() => isHydrated(a.page)).toBe(true);
      expect(await contactArchivedAt(a.page, xId)).toBe(archivedAtSec);
      expect(await shardIndexes(a.page)).toEqual(aPointers);
      // B opened Y's chat, and that read syncs.
      await expect
        .poll(() => unreadDots(a.page, { archived: xId, listed: listedIds }))
        .toEqual({ [xId]: false, [yId]: false, [unknownId(z)]: true });
      await a.page.goto(`/#chat/${yId}`);
      await expectBubbles(a.page, Y_TEXTS);
    });

    for (const device of devices) device.errors.assertClean();
  } finally {
    for (const device of devices) await device.context.close();
    await heldRelay.close();
  }
});
