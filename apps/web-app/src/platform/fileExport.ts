import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNativePlatform } from "./runtime";

const NATIVE_EXPORT_DIRECTORY = "linky-exports";

export interface FileExport {
  blob: Blob;
  fileName: string;
  /** Title of the native share sheet; browsers save the file directly. */
  title: string;
}

export const isCancelledShareError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;

  const name =
    "name" in error && typeof error.name === "string" ? error.name : "";
  if (name === "AbortError") return true;

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  return /cancel|abort|dismiss/i.test(message);
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });

export const downloadFileInBrowser = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Capacitor's WebView has no download handler, so an anchor pointing at a
// blob: URL does nothing there; the file is written to the app cache and handed
// to the system share sheet instead, which also offers saving it.
export const shareFileNatively = async ({
  blob,
  fileName,
  title,
}: FileExport): Promise<void> => {
  const { uri } = await Filesystem.writeFile({
    path: `${NATIVE_EXPORT_DIRECTORY}/${fileName}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title, files: [uri] });
};

/** Rejects with a cancelled share error when the user dismisses the sheet. */
export const saveFile = async (file: FileExport): Promise<void> => {
  if (isNativePlatform()) {
    await shareFileNatively(file);
    return;
  }
  downloadFileInBrowser(file.blob, file.fileName);
};
