import { useOnchainPayoutWatch } from "./hooks/useOnchainPayoutWatch";
import {
  useOnchainTransfers,
  useOnchainTransfersSync,
} from "./hooks/useOnchainTransfers";
import { isAwaitingPayout } from "./lib/onchainPayouts";
import { onchainOperator } from "./lib/onchainOperator";

const OnchainPayoutWatch = (): null => {
  useOnchainPayoutWatch();
  return null;
};

const OnchainTransfersViews = () => {
  useOnchainTransfersSync();
  // Follows the config and asks Esplora only while a payout is awaited.
  return useOnchainTransfers().some(isAwaitingPayout) ? (
    <OnchainPayoutWatch />
  ) : null;
};

/** On-chain transfers show only with an on-chain operator configured. */
export const OnchainTransfersSync = () =>
  onchainOperator !== null ? <OnchainTransfersViews /> : null;
