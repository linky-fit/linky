import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { type FileExport, type PhotoLibrarySave } from "./fileExportShared";
import { isNativePlatform } from "./runtime";

export {
  type FileExport,
  isCancelledShareError,
  type PhotoLibrarySave,
} from "./fileExportShared";

const NATIVE_EXPORT_DIRECTORY = "linky-exports";

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

/** Browsers and the Capacitor shells have no photo library to save to: null saves a file instead. */
export const saveImageToPhotoLibrary:
  | ((file: FileExport) => Promise<PhotoLibrarySave>)
  | null = null;
