// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
  PENDING_DEEP_LINKS_STORAGE_KEY,
} from "../../utils/constants";
import {
  appendPendingDeepLink,
  readPendingDeepLinks,
  reconcilePendingDeepLinks,
  removePendingDeepLink,
} from "./pendingDeepLinks";

const first = "cashu:cashuAfirst";
const second = "linkauth?o=https%3A%2F%2Fshop.example&n=abc";
const third = "nostrconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=s";

afterEach(() => localStorage.clear());

describe("pending deep link storage", () => {
  it("reads the single link a release before the queue stored", () => {
    localStorage.setItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, first);

    expect(readPendingDeepLinks()).toEqual([first]);
  });

  it("keeps the first link alone under the release's key, so a rollback reads it", () => {
    appendPendingDeepLink(first);
    appendPendingDeepLink(second);

    expect(localStorage.getItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBe(
      first,
    );
    expect(readPendingDeepLinks()).toEqual([first, second]);
  });

  it("moves the release's key to the next link and clears both when done", () => {
    appendPendingDeepLink(first);
    appendPendingDeepLink(second);

    removePendingDeepLink(first);
    expect(localStorage.getItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBe(
      second,
    );

    removePendingDeepLink(second);
    expect(localStorage.getItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_DEEP_LINKS_STORAGE_KEY)).toBeNull();
  });

  it("queues a link behind the one a release stored", () => {
    localStorage.setItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, first);

    expect(appendPendingDeepLink(second)).toEqual([first, second]);
  });

  it.each([
    ["no queue and no link", null, null, []],
    ["only the release's link", null, first, [first]],
    ["a head the release kept", [first, second], first, [first, second]],
    [
      "a head the release handled or cancelled",
      [first, second],
      null,
      [second],
    ],
    ["the only link, cancelled by the release", [first], null, []],
    ["a head the release replaced", [first, second], third, [third, second]],
  ])("reconciles %s", (_name, queue, single, expected) => {
    expect(reconcilePendingDeepLinks(queue, single)).toEqual(expected);
  });

  it("drops a login the release cancelled in between, and writes both keys back", () => {
    appendPendingDeepLink(second);
    appendPendingDeepLink(first);
    // The release shows the login, the user cancels, and it clears its key.
    localStorage.removeItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY);

    expect(readPendingDeepLinks()).toEqual([first]);
    expect(localStorage.getItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBe(
      first,
    );
    expect(localStorage.getItem(PENDING_DEEP_LINKS_STORAGE_KEY)).toBe(
      JSON.stringify([first]),
    );
  });

  it("takes the newer link the release stored in place of the head", () => {
    appendPendingDeepLink(first);
    appendPendingDeepLink(second);
    localStorage.setItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, third);

    expect(readPendingDeepLinks()).toEqual([third, second]);
    expect(localStorage.getItem(PENDING_DEEP_LINKS_STORAGE_KEY)).toBe(
      JSON.stringify([third, second]),
    );
  });

  it("falls back to the release's key when the queue is unreadable", () => {
    localStorage.setItem(PENDING_DEEP_LINKS_STORAGE_KEY, "{");
    localStorage.setItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, first);

    expect(readPendingDeepLinks()).toEqual([first]);
  });
});
