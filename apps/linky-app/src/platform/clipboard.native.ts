import * as Clipboard from "expo-clipboard";

export const writeClipboardText = async (value: string): Promise<boolean> => {
  try {
    return await Clipboard.setStringAsync(value);
  } catch {
    return false;
  }
};

/** The system clipboard; rejects when the write fails. */
export const writeBrowserClipboardText = async (
  text: string,
): Promise<void> => {
  if (!(await Clipboard.setStringAsync(text))) {
    throw new Error("clipboard-write-failed");
  }
};

export const readClipboardText = async (): Promise<string | null> => {
  try {
    return await Clipboard.getStringAsync();
  } catch {
    return null;
  }
};
