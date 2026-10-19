import { Linking, Share } from "react-native";

export type TextShareOutcome =
  | "shared"
  | "cancelled"
  | "failed"
  | "unavailable";

export const canShareTextNatively = (): boolean => true;

export const shareTextNatively = async (
  text: string,
): Promise<TextShareOutcome> => {
  try {
    const result = await Share.share({ message: text });
    return result.action === Share.dismissedAction ? "cancelled" : "shared";
  } catch {
    return "failed";
  }
};

/** Opens a mail, SMS or WhatsApp link outside the app. */
export const openShareUrl = (url: string): void => {
  void Linking.openURL(url).catch(() => undefined);
};
