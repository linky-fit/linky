import { requireOptionalNativeModule } from "expo";
import { Directory, File } from "expo-file-system";
import { PixelRatio } from "react-native";
import {
  bytesToDeviceFile,
  DeviceFile,
  openFilesDirectory,
  readBlobBytes,
} from "../../platform/deviceFile.native";
import {
  MAX_PAGE_ASPECT,
  MAX_PAGE_PIXELS,
  PREVIEW_MAX_PAGES,
} from "./pdfPageLimits";

export interface RenderedPdfPage {
  height: number;
  url: string;
  width: number;
}

interface PdfRenderer {
  renderPages: (
    source: string,
    outputDirectory: string,
    maxPages: number,
    targetWidth: number,
    maxPixels: number,
    maxAspect: number,
  ) => Promise<Array<{ height: number; uri: string; width: number }>>;
}

// apps/expo/modules/linky-pdf-renderer: PDFKit on iOS, PdfRenderer on Android.
const renderer = requireOptionalNativeModule<PdfRenderer>("LinkyPdfRenderer");

export const canRenderPdfPages: boolean = renderer !== null;

/**
 * Rasterizes PDF pages with the system's renderer to JPEG files next to the
 * decrypted chat files. `targetWidth` is the width in points the page is
 * shown at; the caller owns revoking the pages.
 */
export const renderPdfPages = async (
  blob: Blob,
  options: { maxPages?: number; targetWidth: number },
): Promise<RenderedPdfPage[]> => {
  if (renderer === null) throw new Error("pdf-renderer-unavailable");
  const source =
    blob instanceof DeviceFile
      ? blob
      : bytesToDeviceFile(await readBlobBytes(blob), "application/pdf");
  const pages = await renderer.renderPages(
    source.uri,
    new Directory(openFilesDirectory(), "pdf-pages").uri,
    options.maxPages ?? PREVIEW_MAX_PAGES,
    options.targetWidth * Math.min(PixelRatio.get(), 2),
    MAX_PAGE_PIXELS,
    MAX_PAGE_ASPECT,
  );
  return pages.map(({ height, uri, width }) => ({ height, url: uri, width }));
};

export const revokePdfPages = (pages: readonly RenderedPdfPage[]): void => {
  for (const page of pages) {
    const file = new File(page.url);
    if (file.exists) file.delete();
  }
};
