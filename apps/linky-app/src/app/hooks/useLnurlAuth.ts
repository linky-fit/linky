import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { Translate } from "../../i18n";
import { submitLnurlAuth, type LnurlAuthPreview } from "../../lnurlAuth";
import { getUnknownErrorMessage } from "../../utils/unknown";
import {
  lnurlAuthBusyAtom,
  lnurlAuthDoneAtom,
  pendingLnurlAuthAtom,
} from "../state/shell/confirmations";

const SUCCESS_OVERLAY_MS = 2400;

interface UseLnurlAuthParams {
  currentNsec: string | null;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export interface LnurlAuthResult {
  closeLnurlAuthConfirmation: () => void;
  confirmLnurlAuth: () => Promise<void>;
  lnurlAuthIsBusy: boolean;
  lnurlAuthIsDone: boolean;
  pendingLnurlAuthConfirmation: LnurlAuthPreview | null;
  requestLnurlAuthConfirmation: (preview: LnurlAuthPreview) => void;
}

/**
 * LUD-04 signer: a scanned login request waits for the user to approve it, then
 * Linky signs the challenge with the domain's linking key and reports the
 * result. Nothing about the login is stored — the domain owns the session.
 * A confirmed login keeps the sheet up in its done state for a moment; only
 * failures go to the status toast.
 */
export const useLnurlAuth = ({
  currentNsec,
  setStatus,
  t,
}: UseLnurlAuthParams): LnurlAuthResult => {
  const [pendingLnurlAuthConfirmation, setPendingLnurlAuthConfirmation] =
    useAtom(pendingLnurlAuthAtom);
  const [lnurlAuthIsBusy, setLnurlAuthIsBusy] = useAtom(lnurlAuthBusyAtom);
  const [lnurlAuthIsDone, setLnurlAuthIsDone] = useAtom(lnurlAuthDoneAtom);
  const successTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const timerRef = successTimerRef;
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const showDone = React.useCallback(() => {
    setLnurlAuthIsDone(true);
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = setTimeout(() => {
      setLnurlAuthIsDone(false);
      setPendingLnurlAuthConfirmation(null);
      successTimerRef.current = null;
    }, SUCCESS_OVERLAY_MS);
  }, [setPendingLnurlAuthConfirmation, setLnurlAuthIsDone]);

  const requestLnurlAuthConfirmation = React.useCallback(
    (preview: LnurlAuthPreview) => {
      reportAppLog({
        tag: "lnurlAuth.requested",
        summary: `LNURL-auth ${preview.action} requested by ${preview.domain}`,
        links: { lnurlAuthChallenge: preview.k1 },
        payload: { action: preview.action, domain: preview.domain },
      });
      setPendingLnurlAuthConfirmation(preview);
    },
    [setPendingLnurlAuthConfirmation],
  );

  const closeLnurlAuthConfirmation = React.useCallback(() => {
    if (lnurlAuthIsBusy || lnurlAuthIsDone) return;
    setPendingLnurlAuthConfirmation(null);
  }, [lnurlAuthIsBusy, lnurlAuthIsDone, setPendingLnurlAuthConfirmation]);

  const confirmLnurlAuth = React.useCallback(async () => {
    const pending = pendingLnurlAuthConfirmation;
    if (!pending || lnurlAuthIsBusy || lnurlAuthIsDone) return;

    if (!currentNsec) {
      setStatus(`${t("errorPrefix")}: ${t("lnurlAuthUnavailable")}`);
      return;
    }

    setLnurlAuthIsBusy(true);
    try {
      await submitLnurlAuth({ nsec: currentNsec, preview: pending });
      showDone();
      reportAppLog({
        tag: "lnurlAuth.approved",
        summary: `LNURL-auth ${pending.action} accepted by ${pending.domain}`,
        links: { lnurlAuthChallenge: pending.k1 },
        payload: { action: pending.action, domain: pending.domain },
      });
    } catch (error) {
      const message = getUnknownErrorMessage(error, t("lnurlAuthFailed"));
      setStatus(`${t("errorPrefix")}: ${message}`);
      reportAppLog({
        tag: "lnurlAuth.failed",
        summary: `LNURL-auth ${pending.action} failed at ${pending.domain}`,
        links: { lnurlAuthChallenge: pending.k1 },
        payload: {
          action: pending.action,
          domain: pending.domain,
          error: message,
        },
      });
    } finally {
      setLnurlAuthIsBusy(false);
    }
  }, [
    currentNsec,
    lnurlAuthIsBusy,
    lnurlAuthIsDone,
    pendingLnurlAuthConfirmation,
    setStatus,
    showDone,
    t,
    setLnurlAuthIsBusy,
  ]);

  return {
    closeLnurlAuthConfirmation,
    confirmLnurlAuth,
    lnurlAuthIsBusy,
    lnurlAuthIsDone,
    pendingLnurlAuthConfirmation,
    requestLnurlAuthConfirmation,
  };
};
