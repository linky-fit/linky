import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import { WALLET_WARNING_BALANCE_THRESHOLD_SAT } from "../../../utils/constants";
import { walletWarningDismissedAtom } from "../../state/wallet/prefs";
import { useWalletBalance } from "./useWalletInventory";

/** The large-balance warning, until the user dismisses it on this device. */
export const useWalletWarning = () => {
  const { cashuBalance } = useWalletBalance();
  const [dismissed, setDismissed] = useAtom(walletWarningDismissedAtom);
  const dismissWalletWarning = React.useCallback(
    () => setDismissed(true),
    [setDismissed],
  );
  return {
    dismissWalletWarning,
    showWalletWarning:
      cashuBalance > WALLET_WARNING_BALANCE_THRESHOLD_SAT && !dismissed,
  };
};
