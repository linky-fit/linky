export interface FileExport {
  blob: Blob;
  fileName: string;
  /** Title of the native share sheet; browsers save the file directly. */
  title: string;
}

/** How saving to the photo library ended; "denied" when the user refused access. */
export type PhotoLibrarySave = "saved" | "denied";

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
