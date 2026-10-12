// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import { linkauthFragment } from "../testUtils/siteLoginFixtures";
import {
  captureLaunchHashLink,
  subscribeAddContactHashLinks,
  subscribeNotificationOpenHashLinks,
  subscribeScanHashLinks,
} from "./hashLinks";
import { navigateToRoutePath } from "./navigation";

const first = buildCashuToken({ amounts: [16] });
const second = buildCashuToken({ amounts: [8] });
const unsubscribes: Array<() => void> = [];
const subscribeScan = () => {
  const onText = vi.fn<(text: string) => void>();
  unsubscribes.push(subscribeScanHashLinks(onText));
  return onText;
};

/** Resolves once `count` hash changes have been dispatched to the listeners. */
const hashChanges = (count: number) =>
  new Promise<void>((resolve) => {
    let seen = 0;
    const onChange = () => {
      seen += 1;
      if (seen < count) return;
      window.removeEventListener("hashchange", onChange);
      resolve();
    };
    window.addEventListener("hashchange", onChange);
  });

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  window.history.replaceState(null, "", "/");
});

describe("subscribeScanHashLinks", () => {
  it("takes the Cashu link the page loaded with at boot and hands it over once", () => {
    window.history.replaceState(null, "", `/#wallet?cashu=${first}`);
    captureLaunchHashLink();
    expect(window.location.hash).toBe("#wallet");

    const onText = subscribeScan();
    // React's dev effect replay subscribes a second time.
    const replayed = subscribeScan();

    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${first}`);
    expect(replayed).not.toHaveBeenCalled();
  });

  it("keeps the launch link for the subscriber of its kind", () => {
    window.history.replaceState(null, "", `/#wallet?cashu=${first}`);
    captureLaunchHashLink();
    const onNpub = vi.fn<(npub: string) => void>();
    unsubscribes.push(subscribeAddContactHashLinks(onNpub));

    const onText = subscribeScan();

    expect(onNpub).not.toHaveBeenCalled();
    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${first}`);
  });

  it("takes a Cashu link that arrives while the app is open", async () => {
    const onText = subscribeScan();
    const changed = hashChanges(1);

    window.location.hash = `#wallet?cashu=${first}`;
    await changed;

    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${first}`);
    expect(window.location.hash).toBe("#wallet");
  });

  it("still takes a link whose fragment a navigation replaced before its hash change ran", async () => {
    const onText = subscribeScan();
    // The link's hash change, then a navigation such as the one an earlier receive ends with.
    const changed = hashChanges(2);

    window.location.hash = `#wallet?cashu=${second}`;
    navigateToRoutePath("transactions");
    await changed;

    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${second}`);
    expect(window.location.hash).toBe("#transactions");
  });

  it("takes each of two links that arrive back to back", async () => {
    const onText = subscribeScan();
    const changed = hashChanges(2);

    window.location.hash = `#wallet?cashu=${first}`;
    window.location.hash = `#wallet?cashu=${second}`;
    await changed;

    expect(onText.mock.calls).toEqual([
      [`cashu:${first}`],
      [`cashu:${second}`],
    ]);
    expect(window.location.hash).toBe("#wallet");
  });

  it("takes a site login link that arrives while the app is open", async () => {
    const onText = subscribeScan();
    const changed = hashChanges(1);

    window.location.hash = `#${linkauthFragment()}`;
    await changed;

    expect(onText).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#wallet");
  });

  it("ignores route changes and stops listening once unsubscribed", async () => {
    const onText = subscribeScan();
    const changed = hashChanges(2);
    window.location.hash = "#contacts";
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    window.location.hash = `#wallet?cashu=${first}`;
    await changed;

    expect(onText).not.toHaveBeenCalled();
  });
});

describe("subscribeAddContactHashLinks", () => {
  const npub =
    "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

  it("takes a profile link and a Cashu link that arrive in the same turn", async () => {
    const onText = subscribeScan();
    const onNpub = vi.fn<(npub: string) => void>();
    unsubscribes.push(subscribeAddContactHashLinks(onNpub));
    const changed = hashChanges(2);

    window.location.hash = `#add/${npub}`;
    window.location.hash = `#wallet?cashu=${first}`;
    await changed;

    expect(onNpub).toHaveBeenCalledExactlyOnceWith(npub);
    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${first}`);
    expect(window.location.hash).toBe("#wallet");
  });
});

describe("subscribeNotificationOpenHashLinks", () => {
  it("takes a notification tap that arrives while the app is open", async () => {
    const onDetail = vi.fn<(detail: string) => void>();
    unsubscribes.push(subscribeNotificationOpenHashLinks(onDetail));
    const changed = hashChanges(1);

    window.location.hash = `#contacts?${new URLSearchParams({ notificationOpen: '{"type":"dm"}' })}`;
    await changed;

    expect(onDetail).toHaveBeenCalledExactlyOnceWith('{"type":"dm"}');
    expect(window.location.hash).toBe("#contacts");
  });
});
