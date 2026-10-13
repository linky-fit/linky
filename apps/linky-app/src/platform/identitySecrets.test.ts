// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  reportAppLog: vi.fn(),
  writeSecretSet: vi.fn(),
}));

vi.mock("./runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtime")>()),
  getPlatformTarget: () => (mocks.isNativePlatform() ? "android" : "web"),
  isNativePlatform: mocks.isNativePlatform,
}));
vi.mock("./secretStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secretStorage")>();
  mocks.writeSecretSet.mockImplementation(actual.writeSecretSet);
  return { ...actual, writeSecretSet: mocks.writeSecretSet };
});
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

import {
  clearIdentitySecrets,
  persistIdentitySecrets,
  persistSyncedActiveNostrIdentity,
} from "./identitySecrets";
import { makeWebPlatformPorts } from "./ports.web";
import { SecretsWriteFailed } from "./secureStoreSecrets";
import { loadSession } from "./session";

const NSEC = "linky.nostr_nsec";
const APP_MNEMONIC = "linky.initialMnemonic";
const CASHU_MNEMONIC = "linky.cashu_bip85_mnemonic";
const SLIP39 = "linky.nostr_slip39_seed";
const IDENTITY_KEYS = [NSEC, SLIP39, CASHU_MNEMONIC, APP_MNEMONIC];
const APP_MNEMONIC_STATE = "linky.app_mnemonic_state.v1";

const identity = (name: string) => ({
  nsec: `nsec-${name}`,
  appMnemonic: `app-${name}`,
  cashuMnemonic: `cashu-${name}`,
  slip39Seed: `slip39-${name}`,
});

/** Awaits `work` with the push mirror's timeout elapsed, since its fake never settles. */
const pastPushMirror = async (work: Promise<void>) => {
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(1_500);
  await work;
  vi.useRealTimers();
};

const persist = (name: string, overrides: { appMnemonic?: string } = {}) =>
  pastPushMirror(
    persistIdentitySecrets({
      ...identity(name),
      ...overrides,
      identitySource: "derived",
      switchedAtSec: null,
    }),
  );

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

describe("the app mnemonic marker", () => {
  it("records whether a persisted identity has an app mnemonic", async () => {
    await persist("a");
    expect(localStorage.getItem(APP_MNEMONIC_STATE)).toBe("present");

    await persist("b", { appMnemonic: "" });
    expect(localStorage.getItem(APP_MNEMONIC_STATE)).toBe("absent");
  });

  it("is left alone by an nsec-only re-save", async () => {
    await persist("a");
    localStorage.removeItem(APP_MNEMONIC);

    await pastPushMirror(
      persistSyncedActiveNostrIdentity({
        identitySource: "custom",
        nsec: "nsec-c",
        switchedAtSec: null,
      }),
    );

    expect(localStorage.getItem(APP_MNEMONIC_STATE)).toBe("present");
  });

  it.each([["absent"], [null]])(
    "stays %s when the secure store refuses the identity",
    async (before) => {
      if (before === null) localStorage.removeItem(APP_MNEMONIC_STATE);
      else localStorage.setItem(APP_MNEMONIC_STATE, before);
      mocks.writeSecretSet.mockRejectedValueOnce(
        new SecretsWriteFailed([NSEC]),
      );

      await expect(
        persistIdentitySecrets({
          ...identity("a"),
          identitySource: "derived",
          switchedAtSec: null,
        }),
      ).rejects.toBeInstanceOf(SecretsWriteFailed);

      expect(localStorage.getItem(APP_MNEMONIC_STATE)).toBe(before);
    },
  );

  it("records the app mnemonic absent once the identity is cleared", async () => {
    await persist("a");

    await clearIdentitySecrets();

    expect(localStorage.getItem(APP_MNEMONIC)).toBeNull();
    expect(localStorage.getItem(APP_MNEMONIC_STATE)).toBe("absent");
  });
});
