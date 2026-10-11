import { Option, Result } from "effect";
import React from "react";
import type { RunExclusiveTask } from "../../state/wallet/opQueue";
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
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  checkAllCashuTokens: CheckAllCashuTokens | null;
  checkCashuTransfer: CheckCashuTransfer | null;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  forgetCashuTransfer: CashuTransferLifecycle["forget"] | null;
  pushToast: (message: string) => void;
  setCashuBulkCheckIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  runExclusive: RunExclusiveTask;
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
  checkAllCashuTokens,
  checkCashuTransfer,
  forgetCashuTransfer,
  pushToast,
  runExclusive,
  setCashuBulkCheckIsBusy,
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
      const checked = await runExclusive(async () => {
        setStatus(t("cashuChecking"));
        return checkCashuTransfer(id);
      });
      if (Option.isNone(checked)) return "skipped";
      const outcome = checked.value;
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
    },
    [checkCashuTransfer, pushToast, runExclusive, setStatus, t],
  );

  const checkAllCashuTokensAndDeleteInvalid = React.useCallback(async () => {
    if (checkAllCashuTokens === null) return;
    if (cashuBulkCheckIsBusy) return;
    setCashuBulkCheckIsBusy(true);
    try {
      await runExclusive(async () => {
        setStatus(t("cashuChecking"));
        const report = await checkAllCashuTokens();
        setStatus(null);
        if (report.markedSpent.length > 0) {
          pushToast(t("cashuInvalid"));
        } else if (report.unavailableMints.length > 0) {
          pushToast(t("cashuCheckFailed"));
        } else {
          pushToast(t("cashuCheckOk"));
        }
      });
    } finally {
      setCashuBulkCheckIsBusy(false);
    }
  }, [
    cashuBulkCheckIsBusy,
    checkAllCashuTokens,
    pushToast,
    runExclusive,
    setCashuBulkCheckIsBusy,
    setStatus,
    t,
  ]);

  return {
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    deleteCashuToken,
  };
};
