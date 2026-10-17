import React from "react";
import { savePrivateImageBlob } from "../lib/privateImageFile";
import { usePushToast, useTranslation } from "./shell";

/** Saves a chat image or file and tells the user how a photo library save ended. */
export const useSavePrivateImage = () => {
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (blob: Blob, links: { rumor?: string }, fileName?: string) => {
      try {
        const result = await savePrivateImageBlob(blob, links, fileName);
        if (result === "saved") pushToast(t("chatImageSaved"));
        if (result === "denied") pushToast(t("chatImageSaveDenied"));
      } catch {
        pushToast(t("chatImageSaveFailed"));
      }
    },
    [pushToast, t],
  );
};
