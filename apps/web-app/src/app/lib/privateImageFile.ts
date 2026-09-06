import { reportAppLog } from "../../devtools/inspector/appLog";

const PDF_FILE_TYPE = "application/pdf";
const EXTENSION_BY_IMAGE_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  [PDF_FILE_TYPE]: "pdf",
};
const MAX_EXPORT_FILE_NAME_LENGTH = 120;

interface PrivateImageExportLinks {
  rumor?: string;
}

// The peer chose the file name, so it is reduced to a plain basename and
// always ends with the extension of the blob's actual type.
export const sanitizeExportFileName = (
  fileName: string,
  extension: string,
): string | null => {
  const baseName = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[<>:"|?*]/g, "")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .replace(/^\.+/, "");
  if (!baseName) return null;
  const suffix = `.${extension}`;
  const stem = baseName.toLowerCase().endsWith(suffix)
    ? baseName.slice(0, -suffix.length)
    : baseName.replace(/\.[^.]*$/, "");
  const trimmedStem = stem.slice(
    0,
    MAX_EXPORT_FILE_NAME_LENGTH - suffix.length,
  );
  return trimmedStem ? `${trimmedStem}${suffix}` : null;
};

const toPrivateImageFile = (blob: Blob, fileName?: string): File => {
  const type = blob.type || "image/jpeg";
  const extension = EXTENSION_BY_IMAGE_TYPE[type] ?? "jpg";
  const baseName = type === PDF_FILE_TYPE ? "linky-document" : "linky-image";
  const safeName =
    fileName !== undefined ? sanitizeExportFileName(fileName, extension) : null;
  return new File([blob], safeName ?? `${baseName}.${extension}`, { type });
};

type ExportEvent = "Saved" | "Shared" | "ShareFailed";

const exportTag = (file: File, event: ExportEvent): string =>
  `${file.type === PDF_FILE_TYPE ? "ChatFile" : "ChatImage"}${event}`;

const reportPrivateImageExport = (
  event: ExportEvent,
  summary: string,
  file: File,
  links: PrivateImageExportLinks,
  error?: unknown,
): void => {
  reportAppLog({
    tag: exportTag(file, event),
    summary,
    links: links.rumor ? { rumor: links.rumor } : {},
    payload: {
      fileName: file.name,
      fileType: file.type,
      size: file.size,
      ...(error !== undefined ? { error } : {}),
    },
  });
};

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

export const downloadPrivateImageBlob = (
  blob: Blob,
  links: PrivateImageExportLinks = {},
  fileName?: string,
): void => {
  const file = toPrivateImageFile(blob, fileName);
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  reportPrivateImageExport("Saved", "Chat file saved as a file", file, links);
};

export const canSharePrivateImage = (): boolean =>
  typeof navigator.share === "function";

export const sharePrivateImageBlob = async (
  blob: Blob,
  title: string,
  links: PrivateImageExportLinks = {},
  fileName?: string,
): Promise<void> => {
  if (!canSharePrivateImage()) {
    throw new Error("share-unavailable");
  }

  const file = toPrivateImageFile(blob, fileName);
  const shareData: ShareData = {
    files: [file],
    title,
  };

  if (
    typeof navigator.canShare === "function" &&
    !navigator.canShare(shareData)
  ) {
    throw new Error("share-unavailable");
  }

  try {
    await navigator.share(shareData);
  } catch (error) {
    if (!isCancelledShareError(error)) {
      reportPrivateImageExport(
        "ShareFailed",
        "System share of a chat file failed",
        file,
        links,
        error,
      );
    }
    throw error;
  }

  reportPrivateImageExport(
    "Shared",
    "Chat file shared via the system share sheet",
    file,
    links,
  );
};
