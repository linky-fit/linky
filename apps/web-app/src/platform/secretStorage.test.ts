import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  getPlatformTarget: () => "android",
  isNativePlatform: () => true,
}));

import { readNativeSecret } from "./secretStorage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readNativeSecret", () => {
  it("reads the Android bridge and tells a missing key apart from a missing store", async () => {
    vi.stubGlobal("LinkyNativeSecretStorage", {
      get: (key: string) => (key === "present" ? "value" : null),
    });

    expect(await readNativeSecret("present")).toBe("value");
    expect(await readNativeSecret("absent")).toBeNull();
  });

  it("resolves undefined when the platform has no native store", async () => {
    expect(await readNativeSecret("present")).toBeUndefined();
  });

  it("rejects when the LinkyNative store fails to answer", async () => {
    vi.stubGlobal("LinkyNative", {
      secretStorage: {
        get: () => Promise.reject(new Error("unavailable")),
        remove: () => Promise.resolve(),
        set: () => Promise.resolve(),
      },
    });

    await expect(readNativeSecret("present")).rejects.toThrow("unavailable");
  });
});
