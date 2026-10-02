import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addToClaimInbox,
  readClaimInbox,
  removeFromClaimInbox,
} from "./npubCashClaimInbox";

const inboxKey = "linky.local.npubCashClaimInbox.v1.owner";

/**
 * Runs `otherTab` the moment this tab first writes to storage, after any read
 * this tab made: the interleaving that lets a read-modify-write lose a write.
 */
const interleaveAtFirstWrite = (otherTab: () => void): void => {
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  let pending: (() => void) | null = otherTab;
  const runOtherTabOnce = (): void => {
    const run = pending;
    pending = null;
    vi.restoreAllMocks();
    run?.();
  };
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    runOtherTabOnce();
    setItem.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    runOtherTabOnce();
    removeItem.call(this, key);
  });
};

describe("npubCashClaimInbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps the tokens two tabs add at once", () => {
    interleaveAtFirstWrite(() => addToClaimInbox(inboxKey, ["cashuBtabB"]));

    expect(addToClaimInbox(inboxKey, ["cashuBtabA"])).toEqual([]);

    expect([...readClaimInbox(inboxKey)].sort()).toEqual([
      "cashuBtabA",
      "cashuBtabB",
    ]);
  });

  it("keeps a token one tab adds while another removes the one it received", () => {
    addToClaimInbox(inboxKey, ["cashuBreceived"]);
    interleaveAtFirstWrite(() => addToClaimInbox(inboxKey, ["cashuBclaimed"]));

    removeFromClaimInbox(inboxKey, "cashuBreceived");

    expect(readClaimInbox(inboxKey)).toEqual(["cashuBclaimed"]);
  });

  it("returns the tokens storage refused", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(addToClaimInbox(inboxKey, ["cashuBrefused"])).toEqual([
      "cashuBrefused",
    ]);
    expect(readClaimInbox(inboxKey)).toEqual([]);
  });

  it("keeps every token out of the storage keys", () => {
    addToClaimInbox(inboxKey, ["cashuBspendable"]);

    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys.join()).not.toContain("cashuBspendable");
    expect(readClaimInbox(inboxKey)).toEqual(["cashuBspendable"]);
  });

  it("reads only its own inbox's tokens", () => {
    addToClaimInbox(inboxKey, ["cashuBmine"]);
    addToClaimInbox(`${inboxKey}x`, ["cashuBother"]);
    localStorage.setItem(inboxKey, "[]");

    expect(readClaimInbox(inboxKey)).toEqual(["cashuBmine"]);
  });
});
