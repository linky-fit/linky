import React from "react";
import {
  WALLET_WARNING_BALANCE_THRESHOLD_SAT,
  WALLET_WARNING_DISMISSED_STORAGE_KEY,
} from "../../../utils/constants";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";

/** The large-balance warning, until the user dismisses it on this device. */
export const useWalletWarning = (cashuBalance: number) => {
  const [walletWarningDismissed, setWalletWarningDismissed] = React.useState(
    () => safeLocalStorageGet(WALLET_WARNING_DISMISSED_STORAGE_KEY) === "1",
  );
  const dismissWalletWarning = React.useCallback(() => {
    safeLocalStorageSet(WALLET_WARNING_DISMISSED_STORAGE_KEY, "1");
    setWalletWarningDismissed(true);
  }, []);
  return {
    dismissWalletWarning,
    walletWarningApplies: cashuBalance > WALLET_WARNING_BALANCE_THRESHOLD_SAT,
    walletWarningDismissed,
  };
};
