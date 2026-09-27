import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  share: vi.fn<(options: unknown) => Promise<{ activityType?: string }>>(
    async () => ({}),
  ),
  writeFile: vi.fn<(options: unknown) => Promise<{ uri: string }>>(
    async () => ({ uri: "file:///cache/linky-exports/export.txt" }),
  ),
}));

vi.mock("./runtime", () => ({ isNativePlatform: mocks.isNativePlatform }));
vi.mock("@capacitor/share", () => ({ Share: { share: mocks.share } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: mocks.writeFile },
}));

import { isCancelledShareError, saveFile } from "./fileExport";

describe("fileExport", () => {
  const click = vi.fn();

  beforeEach(() => {
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.share.mockClear();
    mocks.writeFile.mockClear();
    click.mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("downloads through an anchor in the browser", async () => {
    await saveFile({
      blob: new Blob(["{}"], { type: "text/plain" }),
      fileName: "export.txt",
      title: "Export",
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("writes the file to the app cache and opens the share sheet natively", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    await saveFile({
      blob: new Blob(["{}"], { type: "text/plain" }),
      fileName: "export.txt",
      title: "Export",
    });
    expect(click).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: "linky-exports/export.txt",
      data: btoa("{}"),
      directory: "CACHE",
      recursive: true,
    });
    expect(mocks.share).toHaveBeenCalledWith({
      title: "Export",
      files: ["file:///cache/linky-exports/export.txt"],
    });
  });

  it("surfaces a dismissed native share sheet as a cancelled share", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.share.mockRejectedValueOnce(new Error("Share canceled"));
    const failure = await saveFile({
      blob: new Blob(["{}"]),
      fileName: "export.txt",
      title: "Export",
    }).catch((error: unknown) => error);
    expect(isCancelledShareError(failure)).toBe(true);
    expect(isCancelledShareError(new Error("disk full"))).toBe(false);
  });
});
