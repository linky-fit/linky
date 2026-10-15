// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeWebPlatformPorts } from "./ports.web";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  readNativeSecret:
    vi.fn<(key: string) => Promise<string | null | undefined>>(),
}));
vi.mock("./runtime", () => ({ isNativePlatform: mocks.isNativePlatform }));
vi.mock("./secretStorage", () => ({
  readNativeSecret: mocks.readNativeSecret,
}));

const { secrets } = makeWebPlatformPorts();

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("web secrets port", () => {
  it("reads localStorage in the browser", async () => {
    localStorage.setItem("linky.nostr_nsec", " nsec1 ");
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Found",
      value: "nsec1",
    });
    await expect(secrets.read("linky.initialMnemonic")).resolves.toEqual({
      _tag: "Missing",
    });
    expect(mocks.readNativeSecret).not.toHaveBeenCalled();
  });

  it("reads the native store in the native shells and reports its failure", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    localStorage.setItem("linky.nostr_nsec", "nsec1local");
    mocks.readNativeSecret.mockResolvedValueOnce(null);
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Missing",
    });
    mocks.readNativeSecret.mockResolvedValueOnce(undefined);
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Missing",
    });
    mocks.readNativeSecret.mockRejectedValueOnce(new Error("bridge down"));
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Unavailable",
      cause: "bridge down",
    });
  });
});
