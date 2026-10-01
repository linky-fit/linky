import { Result } from "effect";
import React from "react";
import type { CashuOperationId } from "../../../evolu";
import { navigateTo } from "../../../hooks/useRouting";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import type {
  CashuTransferLifecycle,
  CheckAllCashuTokens,
  CheckCashuTransfer,
} from "../composition/useLinkshuComposition";
import type { Translate } from "../../../i18n";
import { getUnknownErrorMessage } from "../../../utils/unknown";

interface UseCashuTokenChecksParams {
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  checkAllCashuTokens: CheckAllCashuTokens | null;
  checkCashuTransfer: CheckCashuTransfer | null;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  forgetCashuTransfer: CashuTransferLifecycle["forget"] | null;
  pushToast: (message: string) => void;
  setCashuBulkCheckIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

/**
 * NUT-07 validation over linkshu `Validation`: the mint's checkstate answer
 * is the sole truth, spent proofs are marked so, and a handed-out transfer
 * whose proofs are all spent closes as claimed. This hook wraps the calls
 * with busy flags, statuses, and toasts, and hosts the (unrelated)
 * transfer-close confirmation.
 */
export const useCashuTokenChecks = ({
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  checkAllCashuTokens,
  checkCashuTransfer,
  forgetCashuTransfer,
  pushToast,
  setCashuBulkCheckIsBusy,
  setCashuIsBusy,
  setStatus,
  t,
}: UseCashuTokenChecksParams) => {
  const deleteCashuToken = React.useCallback(
    async (id: CashuOperationId) => {
      if (forgetCashuTransfer === null) {
        pushToast(t("errorPrefix"));
        return;
      }
      try {
        const outcome = await forgetCashuTransfer(id);
        if (Result.isFailure(outcome)) {
          setStatus(
            `${t("errorPrefix")}: ${describeTaggedCashuError(outcome.failure) ?? outcome.failure._tag}`,
          );
          return;
        }
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "unknown")}`,
        );
        return;
      }
      setStatus(t("cashuDeleted"));
      navigateTo({ route: "wallet" });
    },
    [forgetCashuTransfer, pushToast, setStatus, t],
  );

  const checkAndRefreshCashuToken = React.useCallback(
    async (
      id: CashuOperationId,
    ): Promise<"ok" | "invalid" | "transient" | "skipped"> => {
      if (checkCashuTransfer === null) {
        pushToast(t("errorPrefix"));
        return "skipped";
      }
      if (cashuIsBusy) return "skipped";
      setCashuIsBusy(true);
      setStatus(t("cashuChecking"));
      try {
        const outcome = await checkCashuTransfer(id);
        if (Result.isFailure(outcome)) {
          pushToast(t("errorPrefix"));
          return "skipped";
        }
        switch (outcome.success.status) {
          case "live":
            setStatus(null);
            pushToast(t("cashuCheckOk"));
            return "ok";
          case "spent":
            setStatus(t("cashuInvalid"));
            pushToast(t("cashuInvalid"));
            return "invalid";
          case "unavailable":
            setStatus(t("cashuCheckFailed"));
            pushToast(t("cashuCheckFailed"));
            return "transient";
        }
      } finally {
        setCashuIsBusy(false);
      }
    },
    [cashuIsBusy, checkCashuTransfer, pushToast, setCashuIsBusy, setStatus, t],
  );

  const checkAllCashuTokensAndDeleteInvalid = React.useCallback(async () => {
    if (checkAllCashuTokens === null) return;
    if (cashuBulkCheckIsBusy) return;
    if (cashuIsBusy) return;
    setCashuBulkCheckIsBusy(true);
    setCashuIsBusy(true);
    setStatus(t("cashuChecking"));
    try {
      const report = await checkAllCashuTokens();
      setStatus(null);
      if (report.markedSpent.length > 0) {
        pushToast(t("cashuInvalid"));
      } else if (report.unavailableMints.length > 0) {
        pushToast(t("cashuCheckFailed"));
      } else {
        pushToast(t("cashuCheckOk"));
      }
    } finally {
      setCashuIsBusy(false);
      setCashuBulkCheckIsBusy(false);
    }
  }, [
    cashuBulkCheckIsBusy,
    cashuIsBusy,
    checkAllCashuTokens,
    pushToast,
    setCashuBulkCheckIsBusy,
    setCashuIsBusy,
    setStatus,
    t,
  ]);

  return {
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    deleteCashuToken,
  };
};
