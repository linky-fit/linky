import { Share } from "@capacitor/share";
import { isNativePlatform } from "./runtime";

export type TextShareOutcome =
  | "shared"
  | "cancelled"
  | "failed"
  | "unavailable";

/** Whether the platform has a share sheet for plain text. */
export const canShareTextNatively = (): boolean =>
  isNativePlatform() || typeof navigator.share === "function";

const errorField = (error: unknown, field: "message" | "name"): string => {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return "";
  }
  const value: unknown = Reflect.get(error, field);
  return typeof value === "string" ? value : "";
};

/** Hands `text` to the native or browser share sheet. */
export const shareTextNatively = async (
  text: string,
): Promise<TextShareOutcome> => {
  if (isNativePlatform()) {
    try {
      await Share.share({ text });
      return "shared";
    } catch (error) {
      return /cancel|abort|dismiss/i.test(errorField(error, "message"))
        ? "cancelled"
        : "failed";
    }
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (error) {
      return errorField(error, "name") === "AbortError"
        ? "cancelled"
        : "failed";
    }
  }
  return "unavailable";
};

/** Opens a mail, SMS or WhatsApp link outside the app. */
export const openShareUrl = (url: string): void => {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
};
