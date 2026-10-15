export interface RenderedPdfPage {
  height: number;
  url: string;
  width: number;
}

const PREVIEW_MAX_PAGES = 30;
// Page geometry is peer-controlled; a page never rasterizes to more than
// this many device pixels (≈ 4 MP, 16 MB of RGBA).
const MAX_PAGE_PIXELS = 4_000_000;
const MAX_PAGE_ASPECT = 8;

const fitScaleToPixelBudget = (
  requestedScale: number,
  baseWidth: number,
  baseHeight: number,
): number => {
  const pixels = baseWidth * baseHeight * requestedScale * requestedScale;
  return pixels > MAX_PAGE_PIXELS
    ? requestedScale * Math.sqrt(MAX_PAGE_PIXELS / pixels)
    : requestedScale;
};

const loadPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
};

const canvasToObjectUrl = async (canvas: HTMLCanvasElement): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(URL.createObjectURL(blob));
        else reject(new Error("pdf-page-encode-failed"));
      },
      "image/jpeg",
      0.85,
    );
  });

/**
 * Rasterizes PDF pages to JPEG object URLs. `targetWidth` is the CSS pixel
 * width the page will be shown at; the caller owns revoking the URLs.
 */
export const renderPdfPages = async (
  blob: Blob,
  options: { maxPages?: number; targetWidth: number },
): Promise<RenderedPdfPage[]> => {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const document = await loadingTask.promise;
  const pageCount = Math.min(
    document.numPages,
    options.maxPages ?? PREVIEW_MAX_PAGES,
  );
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const pages: RenderedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      if (
        !(baseViewport.width > 0) ||
        !(baseViewport.height > 0) ||
        baseViewport.height / baseViewport.width > MAX_PAGE_ASPECT
      ) {
        throw new Error("pdf-page-geometry-unsupported");
      }
      const scale = fitScaleToPixelBudget(
        (options.targetWidth * pixelRatio) / baseViewport.width,
        baseViewport.width,
        baseViewport.height,
      );
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("pdf-canvas-unavailable");
      await page.render({ canvas, canvasContext, viewport }).promise;
      pages.push({
        height: canvas.height,
        url: await canvasToObjectUrl(canvas),
        width: canvas.width,
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
};

export const revokePdfPages = (pages: readonly RenderedPdfPage[]): void => {
  for (const page of pages) URL.revokeObjectURL(page.url);
};
