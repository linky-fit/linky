import { Either } from "effect";
import React from "react";
import type { CashuTokenId } from "../../../evolu";
import { navigateTo } from "../../../hooks/useRouting";
import type {
  CheckAllCashuTokens,
  CheckCashuTokenRow,
} from "../composition/useLinkshuComposition";
import type { Translate } from "../../../i18n";

interface UseCashuTokenChecksParams {
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  checkAllCashuTokens: CheckAllCashuTokens | null;
  checkCashuTokenRow: CheckCashuTokenRow | null;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  forgetCashuToken: ((rowId: string) => Promise<void>) | null;
  pendingCashuDeleteId: CashuTokenId | null;
  pushToast: (message: string) => void;
  setCashuBulkCheckIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingCashuDeleteId: React.Dispatch<
    React.SetStateAction<CashuTokenId | null>
  >;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

/**
 * NUT-07 token validation over linkshu `Validation`: the mint's checkstate
 * answer is the sole truth, fully spent rows become `error` rows, and a
 * partially spent row keeps only its surviving proofs — the package owns the
 * pruning and re-encoding. This hook wraps the calls with busy flags,
 * statuses, and toasts, and hosts the (unrelated) row-delete confirmation.
 */
export const useCashuTokenChecks = ({
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  checkAllCashuTokens,
  checkCashuTokenRow,
  forgetCashuToken,
  pendingCashuDeleteId,
  pushToast,
  setCashuBulkCheckIsBusy,
  setCashuIsBusy,
  setPendingCashuDeleteId,
  setStatus,
  t,
}: UseCashuTokenChecksParams) => {
  const handleDeleteCashuToken = React.useCallback(
    async (id: CashuTokenId) => {
      if (forgetCashuToken === null) {
        pushToast(t("errorPrefix"));
        return;
      }
      try {
        await forgetCashuToken(id);
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error)}`);
        return;
      }
      setStatus(t("cashuDeleted"));
      setPendingCashuDeleteId(null);
      navigateTo({ route: "wallet" });
    },
    [forgetCashuToken, pushToast, setPendingCashuDeleteId, setStatus, t],
  );

  const checkAndRefreshCashuToken = React.useCallback(
    async (
      id: CashuTokenId,
    ): Promise<"ok" | "invalid" | "transient" | "skipped"> => {
      if (checkCashuTokenRow === null) {
        pushToast(t("errorPrefix"));
        return "skipped";
      }
      if (cashuIsBusy) return "skipped";
      setCashuIsBusy(true);
      setStatus(t("cashuChecking"));
      try {
        const outcome = await checkCashuTokenRow(id);
        if (Either.isLeft(outcome)) {
          pushToast(t("errorPrefix"));
          return "skipped";
        }
        switch (outcome.right.status) {
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
    [cashuIsBusy, checkCashuTokenRow, pushToast, setCashuIsBusy, setStatus, t],
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

  const requestDeleteCashuToken = React.useCallback(
    (id: CashuTokenId) => {
      if (pendingCashuDeleteId === id) {
        void handleDeleteCashuToken(id);
        return;
      }
      setPendingCashuDeleteId(id);
      setStatus(t("deleteArmedHint"));
    },
    [
      handleDeleteCashuToken,
      pendingCashuDeleteId,
      setPendingCashuDeleteId,
      setStatus,
      t,
    ],
  );

  return {
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    requestDeleteCashuToken,
  };
};
