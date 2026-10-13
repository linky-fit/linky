// pdf.js needs canvas and a module worker, and hermesc rejects its import(<url>);
// native shows PDFs through the share sheet until P8.

export const canRenderPdfPages = false;

export interface RenderedPdfPage {
  height: number;
  url: string;
  width: number;
}

export const renderPdfPages: (
  blob: Blob,
  options: { maxPages?: number; targetWidth: number },
) => Promise<RenderedPdfPage[]> = () =>
  Promise.reject(new Error("PDF previews are not available in the app yet"));

export const revokePdfPages: (
  pages: readonly RenderedPdfPage[],
) => void = () => {};
