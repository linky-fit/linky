import { useAtom, useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import type { CashuOperationId } from "../../../evolu";
import {
  canShareTextNatively,
  openShareUrl,
  shareTextNatively,
} from "../../../platform/textShare";
import { shareOptionsTextAtom } from "../../state/shell/overlays";
import { useWalletInventory } from "../wallet/useWalletInventory";
import { useWalletTokens } from "../wallet/useWalletTokens";
import { useCopyText, usePushToast, useTranslation } from "./index";

/** Shares text through the share sheet; `whenUnavailable` runs where none exists. */
export const useShareText = () => {
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (value: string, whenUnavailable?: () => Promise<void>) => {
      const text = value.trim();
      if (!text) {
        pushToast(t("errorPrefix"));
        return;
      }
      const outcome = await shareTextNatively(text);
      if (outcome === "failed") pushToast(t("shareFailed"));
      if (outcome !== "unavailable") return;
      if (whenUnavailable) await whenUnavailable();
      else pushToast(t("shareUnavailable"));
    },
    [pushToast, t],
  );
};

/** Shares an issued token's text; without a share sheet it opens the share options. */
export const useShareCashuToken = () => {
  const shareText = useShareText();
  const setShareOptionsText = useAtomSet(shareOptionsTextAtom);
  const { transfers } = useWalletInventory();
  const { markCashuTokenIssued } = useWalletTokens();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (id: CashuOperationId, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        pushToast(t("cashuInvalid"));
        return;
      }

      const transfer = transfers.find(
        (candidate) => String(candidate.id) === id,
      );
      if (!transfer) {
        pushToast(t("cashuInvalid"));
        return;
      }

      if (canShareTextNatively()) {
        await shareText(trimmed);
      } else {
        setShareOptionsText(trimmed);
      }

      // A messenger send shared by hand is now out there like a QR token.
      if (transfer.kind === "send" && transfer.status === "pending") {
        await markCashuTokenIssued(id);
      }
    },
    [
      markCashuTokenIssued,
      pushToast,
      setShareOptionsText,
      shareText,
      t,
      transfers,
    ],
  );
};

/** The share options sheet: copy, or open a mail, SMS or WhatsApp draft. */
export const useShareOptions = () => {
  const [shareOptionsText, setShareOptionsText] = useAtom(shareOptionsTextAtom);
  const copyText = useCopyText();
  const text = (shareOptionsText ?? "").trim();

  const closeShareOptions = React.useCallback(
    () => setShareOptionsText(null),
    [setShareOptionsText],
  );
  const openDraft = React.useCallback(
    (url: string) => {
      openShareUrl(url);
      setShareOptionsText(null);
    },
    [setShareOptionsText],
  );
  const copyShareOptionsText = React.useCallback(async () => {
    if (!text) return;
    await copyText(text);
    setShareOptionsText(null);
  }, [copyText, setShareOptionsText, text]);

  return {
    closeShareOptions,
    copyShareOptionsText,
    shareOptionsText,
    shareOptionsViaEmail: () => {
      if (text) openDraft(`mailto:?body=${encodeURIComponent(text)}`);
    },
    shareOptionsViaSms: () => {
      if (text) openDraft(`sms:?body=${encodeURIComponent(text)}`);
    },
    shareOptionsViaWhatsApp: () => {
      if (text) openDraft(`https://wa.me/?text=${encodeURIComponent(text)}`);
    },
  };
};
