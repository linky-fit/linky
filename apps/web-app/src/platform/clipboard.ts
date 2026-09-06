import { Clipboard } from "@capacitor/clipboard";
import { isNativePlatform } from "./runtime";

export const writeClipboardText = async (value: string): Promise<boolean> => {
  const text = value;

  if (isNativePlatform()) {
    try {
      await Clipboard.write({ string: text });
      return true;
    } catch {
      // Fall through to browser clipboard when available.
    }
  }

  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const readClipboardText = async (): Promise<string | null> => {
  if (isNativePlatform()) {
    try {
      const result = await Clipboard.read();
      const text = result.value;
      return text;
    } catch {
      // Fall through to browser clipboard when available.
    }
  }

  if (!navigator.clipboard?.readText) {
    return null;
  }

  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
};
