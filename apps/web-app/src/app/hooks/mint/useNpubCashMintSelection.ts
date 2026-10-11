import {
  decodeNsec,
  makeNip98AuthHeader as makeLinkstrNip98AuthHeader,
  UnixSeconds,
} from "@linky-fit/linkstr";
import React from "react";
import { normalizeMintUrl } from "../../../utils/mint";
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
} from "../../../utils/npubCashServer";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";
import type { WriteOutcome } from "../../lib/storeWrite";
import type { DefaultMintChoice } from "../../state/wallet/defaultMint";

interface UseNpubCashMintSelectionParams {
  currentNpub: string | null;
  currentNsec: string | null;
  defaultMintChoice: DefaultMintChoice;
  npubCashMintSyncRef: React.RefObject<string | null>;
  pushToast: (message: string) => void;
  setDefaultMint: (mint: string) => Promise<WriteOutcome>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useNpubCashMintSelection = ({
  currentNpub,
  currentNsec,
  defaultMintChoice,
  npubCashMintSyncRef,
  pushToast,
  setDefaultMint,
  setStatus,
  t,
}: UseNpubCashMintSelectionParams) => {
  const makeNip98AuthHeader = React.useCallback(
    async (url: string, method: string, payload?: Record<string, string>) => {
      if (!currentNsec) throw new Error("Missing nsec");
      const secretKey = decodeNsec(currentNsec);
      if (!secretKey) throw new Error("Invalid nsec");

      return makeLinkstrNip98AuthHeader(
        payload === undefined ? { url, method } : { url, method, payload },
        secretKey,
        UnixSeconds.make(nowSeconds()),
      );
    },
    [currentNsec],
  );

  const updateNpubCashMint = React.useCallback(
    async (mintUrl: string): Promise<void> => {
      if (isNpubCashDisabled()) return;
      if (!currentNpub) throw new Error("Missing npub");
      if (!currentNsec) throw new Error("Missing nsec");
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned) return;

      const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info/mint`;

      const payload = { mintUrl: cleaned };
      const auth = await makeNip98AuthHeader(url, "PUT", payload);
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("npub.cash mint update failed");
      }
    },
    [currentNpub, currentNsec, makeNip98AuthHeader],
  );

  const applyDefaultMintSelection = React.useCallback(
    async (mintUrl: string): Promise<boolean> => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned) {
        pushToast(t("mintUrlInvalid"));
        return false;
      }
      try {
        new URL(cleaned);
      } catch {
        pushToast(t("mintUrlInvalid"));
        return false;
      }

      try {
        setStatus(t("mintUpdating"));
        await updateNpubCashMint(cleaned);
      } catch (error) {
        const message = String(error ?? "");
        if (message.includes("Missing nsec")) {
          pushToast(t("profileMissingNpub"));
        } else {
          pushToast(t("mintUpdateFailed"));
        }
        setStatus(null);
        return false;
      }

      npubCashMintSyncRef.current = cleaned;
      await setDefaultMint(cleaned);

      setStatus(t("mintSaved"));
      return true;
    },
    [
      npubCashMintSyncRef,
      pushToast,
      setDefaultMint,
      setStatus,
      t,
      updateNpubCashMint,
    ],
  );

  React.useEffect(() => {
    const cleaned = normalizeMintUrl(defaultMintChoice.mint ?? "");
    if (!cleaned) return;
    if (!defaultMintChoice.chosen) return;
    if (npubCashMintSyncRef.current === cleaned) return;

    npubCashMintSyncRef.current = cleaned;
    void updateNpubCashMint(cleaned).catch(() => {
      npubCashMintSyncRef.current = null;
    });
  }, [defaultMintChoice, npubCashMintSyncRef, updateNpubCashMint]);

  return {
    applyDefaultMintSelection,
    makeNip98AuthHeader,
  };
};
