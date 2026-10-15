// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  reportAppLog: vi.fn(),
}));

vi.mock("./runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtime")>()),
  getPlatformTarget: () => (mocks.isNativePlatform() ? "android" : "web"),
  isNativePlatform: mocks.isNativePlatform,
}));
vi.mock("../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));
vi.mock("./linkshu/wipeLinkshuSeedBoundState", () => ({
  wipeLinkshuSeedBoundState: () => Promise.resolve(),
}));
vi.mock("../utils/pushNsecStorage", () => ({
  clearStoredPushNsec: () => Promise.resolve(),
  setStoredPushNsec: () => new Promise<void>(() => {}),
}));

// The wipe derives a seed on WebCrypto, which settles outside the fake clock.
vi.mock("./linkshu/wipeLinkshuSeedBoundState", () => ({
  wipeLinkshuSeedBoundState: () => Promise.resolve(),
}));

import { persistIdentitySecrets } from "./identitySecrets";
import { makeWebPlatformPorts } from "./ports.web";
import { loadSession } from "./session";

const NSEC = "linky.nostr_nsec";
const APP_MNEMONIC = "linky.initialMnemonic";
const CASHU_MNEMONIC = "linky.cashu_bip85_mnemonic";
const SLIP39 = "linky.nostr_slip39_seed";
const IDENTITY_KEYS = [NSEC, SLIP39, CASHU_MNEMONIC, APP_MNEMONIC];

const identity = (name: string) => ({
  nsec: `nsec-${name}`,
  appMnemonic: `app-${name}`,
  cashuMnemonic: `cashu-${name}`,
  slip39Seed: `slip39-${name}`,
});

/** Persists with the push mirror's timeout elapsed, since its fake never settles. */
const persist = async (name: string) => {
  vi.useFakeTimers();
  const persisting = persistIdentitySecrets({
    ...identity(name),
    identitySource: "derived",
    switchedAtSec: null,
  });
  await vi.advanceTimersByTimeAsync(1_500);
  await persisting;
  vi.useRealTimers();
};

interface NativeWriteFailure {
  /** Keys whose write throws. */
  readonly failingKeys?: ReadonlyArray<string>;
  /** Keys whose write is dropped without an error. */
  readonly ignoredKeys?: ReadonlyArray<string>;
}

/** The Android secret storage bridge; `fail` makes the next writes fail. */
const installAndroidStore = () => {
  const store = new Map<string, string>();
  let failure: NativeWriteFailure = {};
  vi.stubGlobal("LinkyNativeSecretStorage", {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      if (failure.failingKeys?.includes(key)) throw new Error("keystore busy");
      if (!failure.ignoredKeys?.includes(key)) store.set(key, value);
    },
    remove: (key: string) => void store.delete(key),
  });
  return {
    store,
    fail: (next: NativeWriteFailure) => {
      failure = next;
    },
  };
};

const localSecrets = () =>
  Object.fromEntries(
    IDENTITY_KEYS.map((key) => [key, localStorage.getItem(key)]),
  );

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.isNativePlatform.mockReturnValue(false);
});

describe("persistIdentitySecrets", () => {
  it("does not let a blocked push-secret mirror stall account restore", async () => {
    vi.useFakeTimers();
    let completed = false;
    const persisting = persistIdentitySecrets({
      ...identity("b"),
      identitySource: "derived",
      switchedAtSec: null,
    }).then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await persisting;
    expect(localStorage.getItem(NSEC)).toBe("nsec-b");
  });

  it("writes the new set to the native store and localStorage", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    const native = installAndroidStore();

    await persist("b");

    expect(Object.fromEntries(native.store)).toEqual({
      [NSEC]: "nsec-b",
      [APP_MNEMONIC]: "app-b",
      [CASHU_MNEMONIC]: "cashu-b",
      [SLIP39]: "slip39-b",
    });
    expect(localSecrets()).toEqual(Object.fromEntries(native.store));
    expect(mocks.reportAppLog).not.toHaveBeenCalled();
  });

  it.each([
    ["throws", { failingKeys: [SLIP39] }],
    ["drops it silently", { ignoredKeys: [SLIP39] }],
  ])(
    "boots the new identity from localStorage when a native write %s",
    async (_, failure) => {
      mocks.isNativePlatform.mockReturnValue(true);
      const native = installAndroidStore();
      await persist("a");
      native.fail(failure);

      await persist("b");

      expect(native.store.size).toBe(0);
      expect(localSecrets()).toEqual({
        [NSEC]: "nsec-b",
        [APP_MNEMONIC]: "app-b",
        [CASHU_MNEMONIC]: "cashu-b",
        [SLIP39]: "slip39-b",
      });
      expect(mocks.reportAppLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: "secrets.nativeWriteRolledBack",
          payload: { keys: IDENTITY_KEYS, missed: [SLIP39], notRemoved: [] },
        }),
      );
      expect(JSON.stringify(mocks.reportAppLog.mock.calls)).not.toMatch(
        /nsec-|app-|cashu-|slip39-/,
      );
      await expect(loadSession(makeWebPlatformPorts())).resolves.toEqual({
        _tag: "SignedIn",
        degraded: false,
        secrets: identity("b"),
      });
    },
  );

  it("keeps the web on localStorage alone", async () => {
    const native = installAndroidStore();

    await persist("b");

    expect(native.store.size).toBe(0);
    expect(localSecrets()[NSEC]).toBe("nsec-b");
    expect(mocks.reportAppLog).not.toHaveBeenCalled();
  });
});
