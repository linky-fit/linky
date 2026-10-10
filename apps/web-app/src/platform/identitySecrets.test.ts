import { afterEach, describe, expect, it, vi } from "vitest";

const storedSecrets = vi.hoisted(() => new Map<string, string>());

vi.mock("./secretStorage", () => ({
  readStoredSecret: (key: string) =>
    Promise.resolve(storedSecrets.get(key) ?? null),
  removeStoredSecret: (key: string) => {
    storedSecrets.delete(key);
    return Promise.resolve();
  },
  writeStoredSecret: (key: string, value: string) => {
    storedSecrets.set(key, value);
    return Promise.resolve();
  },
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

afterEach(() => {
  storedSecrets.clear();
  vi.useRealTimers();
});

describe("persistIdentitySecrets", () => {
  it("does not let a blocked push-secret mirror stall account restore", async () => {
    vi.useFakeTimers();
    let completed = false;

    const persistPromise = persistIdentitySecrets({
      appMnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      cashuMnemonic:
        "legal winner thank year wave sausage worth useful legal winner thank yellow",
      identitySource: "derived",
      nsec: "nsec-test",
      slip39Seed: "slip39-test",
      switchedAtSec: null,
    }).then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await persistPromise;
    expect(completed).toBe(true);
    expect(Array.from(storedSecrets.values())).toContain("nsec-test");
  });
});
