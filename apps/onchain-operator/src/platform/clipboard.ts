/** `false` when the browser refused, e.g. without a user gesture or permission. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** `null` when the browser refused to read the clipboard. */
export const pasteText = async (): Promise<string | null> => {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
};
