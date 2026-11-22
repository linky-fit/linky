import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativePlatform } from "../platform/runtime";
import { getBlossomUploadProxyUrl } from "./blossomUploadProxy";

vi.mock("../platform/runtime", () => ({ isNativePlatform: vi.fn() }));

describe("getBlossomUploadProxyUrl", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("stays on the app's own origin in a browser, localhost included", () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    expect(getBlossomUploadProxyUrl()).toBe("/api/blossom-upload");
  });

  it("uses the hosted app from a native shell", () => {
    vi.mocked(isNativePlatform).mockReturnValue(true);
    expect(getBlossomUploadProxyUrl()).toBe(
      "https://app.linky.fit/api/blossom-upload",
    );
  });
});
