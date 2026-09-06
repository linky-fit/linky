import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorRow } from "../../devtools/inspector/inspectorRows";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import {
  downloadPrivateImageBlob,
  isCancelledShareError,
  sanitizeExportFileName,
  sharePrivateImageBlob,
} from "./privateImageFile";

vi.mock("../../devtools/inspector/reportInspectorRows", () => ({
  reportInspectorRows: vi.fn(),
}));

vi.mock("../../devtools/inspector/inspectorEnabled", () => ({
  getInspectorEmissionEnabled: () => true,
}));

const reportedRows = vi.mocked(reportInspectorRows);

const share = vi.fn<(data?: ShareData) => Promise<void>>(async () => undefined);

const lastReportedRow = (): InspectorRow | undefined =>
  reportedRows.mock.calls.at(-1)?.[0]?.[0];

describe("privateImageFile", () => {
  beforeEach(() => {
    reportedRows.mockClear();
    share.mockReset();
    share.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
      writable: true,
    });
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
    document.body.innerHTML = "";
  });

  it("reports PDF exports under file tags with a sanitized name", async () => {
    await sharePrivateImageBlob(
      new Blob(["%PDF-"], { type: "application/pdf" }),
      "PDF",
      { rumor: "rumor-pdf" },
      "../invoice.exe",
    );
    const shared = share.mock.calls[0]?.[0];
    expect(shared?.files?.[0]?.name).toBe("invoice.pdf");
    expect(lastReportedRow()?.tag).toBe("ChatFileShared");

    downloadPrivateImageBlob(new Blob(["%PDF-"], { type: "application/pdf" }), {
      rumor: "rumor-pdf",
    });
    expect(lastReportedRow()?.tag).toBe("ChatFileSaved");
    expect(lastReportedRow()?.payload).toMatchObject({
      fileName: "linky-document.pdf",
    });
  });

  it("shares the image bytes as a file, never a url or text", async () => {
    await sharePrivateImageBlob(
      new Blob(["img"], { type: "image/jpeg" }),
      "Image",
      { rumor: "rumor-1" },
    );

    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0]?.[0];
    expect(shared?.files?.[0]?.name).toBe("linky-image.jpg");
    expect(shared?.files?.[0]?.type).toBe("image/jpeg");
    expect(shared && "url" in shared).toBe(false);
    expect(shared && "text" in shared).toBe(false);

    const row = lastReportedRow();
    expect(row?.tag).toBe("ChatImageShared");
    expect(row?.links).toEqual({ rumor: "rumor-1" });
  });

  it("derives the file extension from the blob type", async () => {
    await sharePrivateImageBlob(
      new Blob(["img"], { type: "image/png" }),
      "Image",
    );

    expect(share.mock.calls[0]?.[0]?.files?.[0]?.name).toBe("linky-image.png");
  });

  it("throws share-unavailable when the device cannot share", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    await expect(
      sharePrivateImageBlob(new Blob(["img"], { type: "image/jpeg" }), "Image"),
    ).rejects.toThrow("share-unavailable");
  });

  it("reports a failure row only for non-cancel share errors", async () => {
    share.mockRejectedValueOnce(new DOMException("denied", "AbortError"));
    await expect(
      sharePrivateImageBlob(new Blob(["img"], { type: "image/jpeg" }), "Image"),
    ).rejects.toThrow();
    expect(reportedRows).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new Error("boom"));
    await expect(
      sharePrivateImageBlob(new Blob(["img"], { type: "image/jpeg" }), "Image"),
    ).rejects.toThrow("boom");
    expect(lastReportedRow()?.tag).toBe("ChatImageShareFailed");
  });

  it("downloads through an anchor named after the file", () => {
    let downloadName = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });

    downloadPrivateImageBlob(new Blob(["img"], { type: "image/webp" }), {
      rumor: "rumor-2",
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("linky-image.webp");
    const row = lastReportedRow();
    expect(row?.tag).toBe("ChatImageSaved");
    expect(row?.links).toEqual({ rumor: "rumor-2" });
    expect(row && typeof row.payload === "object").toBe(true);
    click.mockRestore();
  });

  it("recognizes cancelled share errors", () => {
    expect(isCancelledShareError(new DOMException("nope", "AbortError"))).toBe(
      true,
    );
    expect(isCancelledShareError(new Error("Share canceled"))).toBe(true);
    expect(isCancelledShareError(new Error("boom"))).toBe(false);
    expect(isCancelledShareError(null)).toBe(false);
  });
});

describe("sanitizeExportFileName", () => {
  it("forces the real extension and strips paths and control characters", () => {
    expect(sanitizeExportFileName("invoice.html", "pdf")).toBe("invoice.pdf");
    expect(sanitizeExportFileName("Invoice 2026.PDF", "pdf")).toBe(
      "Invoice 2026.pdf",
    );
    expect(sanitizeExportFileName("C:\\dir\\a<b>.pdf", "pdf")).toBe("ab.pdf");
    expect(sanitizeExportFileName("..\u0000", "pdf")).toBeNull();
    expect(sanitizeExportFileName(`${"x".repeat(200)}.pdf`, "pdf")).toBe(
      `${"x".repeat(116)}.pdf`,
    );
  });
});
