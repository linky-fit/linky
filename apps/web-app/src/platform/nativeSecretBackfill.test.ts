import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  nativeSecrets: new Map<string, string>(),
  nativeStoreAvailable: true,
  readBack: (value: string | undefined): string | undefined => value,
  reportAppLog: vi.fn(),
  writeNativeSecret: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getPlatformTarget: () => "ios",
  isNativePlatform: mocks.isNativePlatform,
}));

vi.mock("../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));

vi.mock("./secretStorage", () => ({
  readNativeSecret: (key: string) =>
    Promise.resolve(
      mocks.nativeStoreAvailable
        ? (mocks.readBack(mocks.nativeSecrets.get(key)) ?? null)
        : undefined,
    ),
  writeNativeSecret: mocks.writeNativeSecret,
}));

import { backfillNativeSecrets } from "./nativeSecretBackfill";

const NSEC_KEY = "linky.nostr_nsec";
const SEED_KEY = "linky.nostr_slip39_seed";

const reportedPayload = (): unknown =>
  mocks.reportAppLog.mock.calls.at(-1)?.[0]?.payload;

beforeEach(() => {
  mocks.writeNativeSecret.mockImplementation((key: string, value: string) => {
    mocks.nativeSecrets.set(key, value);
    return Promise.resolve();
  });
});

afterEach(() => {
  localStorage.clear();
  mocks.nativeSecrets.clear();
  mocks.nativeStoreAvailable = true;
  mocks.readBack = (value) => value;
  mocks.isNativePlatform.mockReturnValue(true);
  vi.clearAllMocks();
});

describe("backfillNativeSecrets", () => {
  it("copies a localStorage-only secret to the native store and keeps localStorage", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-local");

    await backfillNativeSecrets();

    expect(mocks.nativeSecrets.get(NSEC_KEY)).toBe("nsec-local");
    expect(localStorage.getItem(NSEC_KEY)).toBe("nsec-local");
    expect(reportedPayload()).toMatchObject({
      backfilled: 1,
      outcomes: { [NSEC_KEY]: "backfilled" },
    });
  });

  it("does not write a secret the native store already holds", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-same");
    mocks.nativeSecrets.set(NSEC_KEY, "nsec-same");

    await backfillNativeSecrets();

    expect(mocks.writeNativeSecret).not.toHaveBeenCalled();
    expect(reportedPayload()).toMatchObject({ alreadyPresent: 1 });
  });

  it("reports a differing native value as a mismatch without overwriting it", async () => {
    localStorage.setItem(SEED_KEY, "seed-local");
    mocks.nativeSecrets.set(SEED_KEY, "seed-native");

    await backfillNativeSecrets();

    expect(mocks.writeNativeSecret).not.toHaveBeenCalled();
    expect(mocks.nativeSecrets.get(SEED_KEY)).toBe("seed-native");
    expect(localStorage.getItem(SEED_KEY)).toBe("seed-local");
    expect(reportedPayload()).toMatchObject({
      mismatch: 1,
      outcomes: { [SEED_KEY]: "mismatch" },
    });
  });

  it("reports a rejected write as failed", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-local");
    mocks.writeNativeSecret.mockRejectedValue(new Error("keychain locked"));

    await backfillNativeSecrets();

    expect(reportedPayload()).toMatchObject({ backfilled: 0, failed: 1 });
  });

  it("reports a read-back that differs from the written value as failed", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-local");
    mocks.readBack = (value) => (value ? "nsec-corrupted" : value);

    await backfillNativeSecrets();

    expect(reportedPayload()).toMatchObject({ backfilled: 0, failed: 1 });
  });

  it("reports a platform without a native store as failed", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-local");
    mocks.nativeStoreAvailable = false;

    await backfillNativeSecrets();

    expect(mocks.writeNativeSecret).not.toHaveBeenCalled();
    expect(reportedPayload()).toMatchObject({ failed: 1 });
  });

  it("keeps secret values out of the inspector row", async () => {
    localStorage.setItem(NSEC_KEY, "nsec-local");
    localStorage.setItem(SEED_KEY, "seed-local");
    mocks.nativeSecrets.set(SEED_KEY, "seed-native");

    await backfillNativeSecrets();

    const row = JSON.stringify(mocks.reportAppLog.mock.calls);
    for (const secret of ["nsec-local", "seed-local", "seed-native"]) {
      expect(row).not.toContain(secret);
    }
  });

  it("does nothing on the web", async () => {
    mocks.isNativePlatform.mockReturnValue(false);
    localStorage.setItem(NSEC_KEY, "nsec-local");

    await backfillNativeSecrets();

    expect(mocks.writeNativeSecret).not.toHaveBeenCalled();
    expect(mocks.reportAppLog).not.toHaveBeenCalled();
  });
});
