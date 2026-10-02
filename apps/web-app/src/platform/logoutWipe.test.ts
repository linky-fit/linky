import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishPendingLogout,
  isLogoutPending,
  markLogoutPending,
  onLogoutInAnotherTab,
} from "./logoutWipe";

const opfsEntries = new Set<string>();
const indexedDbs = new Set<string>();
let opfsLocked = false;

const stubGlobal = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, configurable: true });

beforeEach(() => {
  opfsEntries.clear();
  indexedDbs.clear();
  opfsLocked = false;
  stubGlobal(navigator, "locks", {
    request: (_name: string, callback: () => Promise<void>) => callback(),
  });
  stubGlobal(navigator, "storage", {
    getDirectory: () =>
      Promise.resolve({
        keys: async function* () {
          yield* [...opfsEntries];
        },
        removeEntry: (name: string) => {
          if (opfsLocked) {
            return Promise.reject(
              new DOMException("in use", "NoModificationAllowedError"),
            );
          }
          opfsEntries.delete(name);
          return Promise.resolve();
        },
      }),
  });
  stubGlobal(globalThis, "indexedDB", {
    databases: () =>
      Promise.resolve([...indexedDbs].map((name) => ({ name, version: 1 }))),
    deleteDatabase: (name: string) => {
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => {
        indexedDbs.delete(name);
        request.onsuccess?.();
      });
      return request;
    },
  });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("finishPendingLogout", () => {
  it("deletes the Evolu databases, IndexedDB and web storage", async () => {
    opfsEntries.add(".linky-445780c6").add(".linky-anon");
    indexedDbs.add("linky-inspector");
    localStorage.setItem("linky.nostr_nsec", "nsec1...");
    sessionStorage.setItem("linky.in_memory_session.v1", "1");
    markLogoutPending();

    await finishPendingLogout();

    expect(opfsEntries.size).toBe(0);
    expect(indexedDbs.size).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("leaves a fresh session alone once another tab finished the wipe", async () => {
    opfsEntries.add(".linky-anon");
    localStorage.setItem("linky.lang", "cs");

    await finishPendingLogout();

    expect(opfsEntries.size).toBe(1);
    expect(localStorage.getItem("linky.lang")).toBe("cs");
  });

  it("keeps the logout pending while another tab holds the database open", async () => {
    vi.useFakeTimers();
    opfsEntries.add(".linky-445780c6");
    opfsLocked = true;
    markLogoutPending();

    const result = finishPendingLogout();
    const assertion = expect(result).rejects.toThrow("Close other Linky tabs");
    await vi.advanceTimersByTimeAsync(11_000);
    await assertion;

    expect(isLogoutPending()).toBe(true);
    expect(opfsEntries.size).toBe(1);
  });

  it("finishes once the other tab lets go of the database", async () => {
    vi.useFakeTimers();
    opfsEntries.add(".linky-445780c6");
    opfsLocked = true;
    markLogoutPending();

    const result = finishPendingLogout();
    await vi.advanceTimersByTimeAsync(1_000);
    opfsLocked = false;
    await vi.advanceTimersByTimeAsync(1_000);
    await result;

    expect(opfsEntries.size).toBe(0);
    expect(isLogoutPending()).toBe(false);
  });
});

describe("onLogoutInAnotherTab", () => {
  it("fires when another tab marks the logout", () => {
    const callback = vi.fn();
    onLogoutInAnotherTab(callback);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "linky.lang", newValue: "en" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "linky.logoutPending",
        newValue: "1",
      }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
