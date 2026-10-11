import { RegistryContext, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { CashuOperationId } from "../../../evolu";
import {
  cancelNativeNfcWrite,
  startNativeNfcWrite,
  supportsNativeNfcWrite,
} from "../../../platform/nativeBridge";
import { buildCashuDeepLink } from "../../../utils/deepLinks";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { currentNpubAtom } from "../../state/session/session";
import {
  nfcWriteCancelledByUserAtom,
  nfcWritePromptKindAtom,
  type NfcWritePromptKind,
} from "../../state/shell/overlays";
import { useWalletTokens } from "../wallet/useWalletTokens";
import { usePushToast, useTranslation } from "./index";

export const canWriteNfc = supportsNativeNfcWrite;

export const useCancelNfcWrite = () => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(() => {
    registry.set(nfcWriteCancelledByUserAtom, true);
    registry.set(nfcWritePromptKindAtom, null);
    cancelNativeNfcWrite();
  }, [registry]);
};

/** Writes a URI to an NFC tag and reports the outcome as a toast. */
const useWriteNfcUri = () => {
  const registry = React.useContext(RegistryContext);
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (
      url: string,
      successKey: "nfcWriteProfileSuccess" | "nfcWriteTokenSuccess",
      promptKind: NfcWritePromptKind,
    ): Promise<boolean> => {
      registry.set(nfcWriteCancelledByUserAtom, false);

      const result = await startNativeNfcWrite(url, (progress) => {
        if (progress.status === "armed" && progress.prompt === "web") {
          registry.set(nfcWritePromptKindAtom, promptKind);
        }
      });

      registry.set(nfcWritePromptKindAtom, null);

      if (result === null || result.status === "unsupported") {
        pushToast(t("nfcWriteUnsupported"));
        return false;
      }

      if (result.status === "success") {
        pushToast(t(successKey));
        return true;
      }

      if (result.status === "disabled") {
        pushToast(t("nfcWriteDisabled"));
        return false;
      }

      if (result.status === "busy") {
        pushToast(t("nfcWriteBusy"));
        return false;
      }

      if (result.status === "cancelled") {
        if (registry.get(nfcWriteCancelledByUserAtom)) {
          registry.set(nfcWriteCancelledByUserAtom, false);
          return false;
        }

        pushToast(t("nfcWriteCancelled"));
        return false;
      }

      registry.set(nfcWriteCancelledByUserAtom, false);

      const message = (result.message ?? "").trim();
      pushToast(
        message ? `${t("nfcWriteFailed")}: ${message}` : t("nfcWriteFailed"),
      );

      return false;
    },
    [pushToast, registry, t],
  );
};

export const useWriteCashuTokenToNfc = () => {
  const writeNfcUri = useWriteNfcUri();
  const { markCashuTokenExternalized } = useWalletTokens();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (id: CashuOperationId, tokenText: string) => {
      const deepLink = buildCashuDeepLink(tokenText.trim());
      if (!deepLink) {
        pushToast(t("cashuInvalid"));
        return;
      }
      const wrote = await writeNfcUri(
        deepLink,
        "nfcWriteTokenSuccess",
        "token",
      );
      if (!wrote) return;
      await markCashuTokenExternalized(id);
    },
    [markCashuTokenExternalized, pushToast, t, writeNfcUri],
  );
};

export const useWriteCurrentNpubToNfc = () => {
  const writeNfcUri = useWriteNfcUri();
  const currentNpub = useAtomValue(currentNpubAtom);
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(async () => {
    const npub = normalizeNpubIdentifier(currentNpub ?? "");
    if (!npub) {
      pushToast(t("profileMissingNpub"));
      return;
    }
    await writeNfcUri(`nostr://${npub}`, "nfcWriteProfileSuccess", "profile");
  }, [currentNpub, pushToast, t, writeNfcUri]);
};
