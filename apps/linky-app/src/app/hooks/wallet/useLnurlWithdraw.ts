import { useAtom } from "@linky-fit/linkstr-react";
import { Result } from "effect";
import React from "react";
import type { Translate } from "../../../i18n";
import { redeemLnurlWithdraw } from "../../../lnurlPay";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import {
  lnurlWithdrawBusyAtom,
  pendingLnurlWithdrawAtom,
} from "../../state/shell/confirmations";
import type { useTopupFlow } from "../topup/useTopupFlow";

interface UseLnurlWithdrawParams {
  defaultMintUrl: string | null;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  startBackgroundTopup: ReturnType<typeof useTopupFlow>["startBackgroundTopup"];
  t: Translate;
}

/** An LNURL-withdraw the user confirmed, paid into a topup at the default mint. */
export const useLnurlWithdraw = ({
  defaultMintUrl,
  setStatus,
  startBackgroundTopup,
  t,
}: UseLnurlWithdrawParams) => {
  const [
    pendingLnurlWithdrawConfirmation,
    setPendingLnurlWithdrawConfirmation,
  ] = useAtom(pendingLnurlWithdrawAtom);
  const [lnurlWithdrawIsBusy, setLnurlWithdrawIsBusy] = useAtom(
    lnurlWithdrawBusyAtom,
  );

  const closeLnurlWithdrawConfirmation = React.useCallback(() => {
    if (lnurlWithdrawIsBusy) return;
    setPendingLnurlWithdrawConfirmation(null);
  }, [lnurlWithdrawIsBusy, setPendingLnurlWithdrawConfirmation]);

  const confirmLnurlWithdraw = React.useCallback(async () => {
    const pending = pendingLnurlWithdrawConfirmation;
    if (!pending || lnurlWithdrawIsBusy) return;
    const mintUrl = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!mintUrl) {
      setStatus(t("topupInvoiceFailed"));
      return;
    }
    setLnurlWithdrawIsBusy(true);
    try {
      setStatus(t("lnurlWithdrawPreparing"));
      const started = await startBackgroundTopup({
        amountSat: pending.amountSat,
        mint: mintUrl,
      });
      if (Result.isFailure(started)) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(started.failure, "unknown")}`,
        );
        return;
      }
      await redeemLnurlWithdraw({
        callback: pending.callback,
        invoice: started.success.invoice,
        k1: pending.k1,
      });
      setPendingLnurlWithdrawConfirmation(null);
      setStatus(t("lnurlWithdrawPending"));
    } catch (error) {
      setStatus(
        `${t("errorPrefix")}: ${getUnknownErrorMessage(error, t("lnurlWithdrawFailed"))}`,
      );
    } finally {
      setLnurlWithdrawIsBusy(false);
    }
  }, [
    defaultMintUrl,
    lnurlWithdrawIsBusy,
    pendingLnurlWithdrawConfirmation,
    setStatus,
    startBackgroundTopup,
    t,
    setPendingLnurlWithdrawConfirmation,
    setLnurlWithdrawIsBusy,
  ]);

  return {
    closeLnurlWithdrawConfirmation,
    confirmLnurlWithdraw,
    lnurlWithdrawIsBusy,
    pendingLnurlWithdrawConfirmation,
    setPendingLnurlWithdrawConfirmation,
  };
};
