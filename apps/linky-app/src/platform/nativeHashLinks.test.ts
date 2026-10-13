import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import {
  receiveHashLink,
  receiveScanText,
  subscribeAddContactHashLinks,
  subscribeScanHashLinks,
} from "./hashLinks.native";

const token = buildCashuToken({ amounts: [16] });
const unsubscribes: Array<() => void> = [];
const subscribeScan = () => {
  const onText = vi.fn<(text: string) => void>();
  unsubscribes.push(subscribeScanHashLinks(onText));
  return onText;
};

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
});

describe("hashLinks.native", () => {
  it("keeps a launch link for the first subscriber of its kind and hands it over once", () => {
    expect(receiveHashLink(`#wallet?cashu=${token}`)).toBe("wallet");
    const onNpub = vi.fn<(npub: string) => void>();
    unsubscribes.push(subscribeAddContactHashLinks(onNpub));

    const onText = subscribeScan();
    // React's dev effect replay subscribes a second time.
    const replayed = subscribeScan();

    expect(onNpub).not.toHaveBeenCalled();
    expect(onText).toHaveBeenCalledExactlyOnceWith(`cashu:${token}`);
    expect(replayed).not.toHaveBeenCalled();
  });

  it("hands links that arrive while the app runs to the subscriber, in order", () => {
    const onText = subscribeScan();

    receiveScanText("nostr:npub1first");
    expect(receiveHashLink(`#wallet?cashu=${token}`)).toBe("wallet");

    expect(onText.mock.calls).toEqual([
      ["nostr:npub1first"],
      [`cashu:${token}`],
    ]);
  });

  it("keeps every link that arrives before a subscriber, oldest first", () => {
    receiveScanText("nostr:npub1first");
    receiveScanText("nostr:npub1second");

    const onText = subscribeScan();

    expect(onText.mock.calls).toEqual([
      ["nostr:npub1first"],
      ["nostr:npub1second"],
    ]);
  });

  it("takes no link from a fragment that carries none", () => {
    expect(receiveHashLink("#contacts")).toBeNull();
    expect(subscribeScan()).not.toHaveBeenCalled();
  });
});
