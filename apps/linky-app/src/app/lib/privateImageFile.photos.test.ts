import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { savePrivateImageBlob } from "./privateImageFile";

const fileExport = vi.hoisted(() => ({
  downloadFileInBrowser: vi.fn(),
  saveImageToPhotoLibrary: vi.fn(
    async (): Promise<"saved" | "denied"> => "saved",
  ),
}));

vi.mock("../../platform/fileExport", () => ({
  ...fileExport,
  isCancelledShareError: () => false,
  shareFileNatively: vi.fn(),
}));
vi.mock("../../devtools/inspector/reportInspectorRows", () => ({
  reportInspectorRows: vi.fn(),
}));
vi.mock("../../devtools/inspector/inspectorEnabled", () => ({
  getInspectorEmissionEnabled: () => true,
}));

const lastTag = () =>
  vi.mocked(reportInspectorRows).mock.calls.at(-1)?.[0]?.[0]?.tag;

describe("savePrivateImageBlob with a photo library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves an image as a photo", async () => {
    const result = await savePrivateImageBlob(
      new Blob(["x"], { type: "image/png" }),
      { rumor: "r1" },
    );
    expect(result).toBe("saved");
    expect(fileExport.saveImageToPhotoLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "linky-image.png" }),
    );
    expect(lastTag()).toBe("ChatImageSavedToPhotos");
  });

  it("reports a refused photo access", async () => {
    fileExport.saveImageToPhotoLibrary.mockResolvedValueOnce("denied");
    const result = await savePrivateImageBlob(
      new Blob(["x"], { type: "image/jpeg" }),
    );
    expect(result).toBe("denied");
    expect(lastTag()).toBe("ChatImagePhotosDenied");
  });

  it("saves a PDF as a file, never as a photo", async () => {
    const result = await savePrivateImageBlob(
      new Blob(["%PDF-"], { type: "application/pdf" }),
    );
    expect(result).toBe("downloaded");
    expect(fileExport.saveImageToPhotoLibrary).not.toHaveBeenCalled();
    expect(fileExport.downloadFileInBrowser).toHaveBeenCalled();
  });
});
