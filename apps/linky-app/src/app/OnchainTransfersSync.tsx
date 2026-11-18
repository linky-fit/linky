import { useOnchainTransfersSync } from "./hooks/useOnchainTransfers";
import { onchainOperator } from "./lib/onchainOperator";

const OnchainTransfersViews = (): null => {
  useOnchainTransfersSync();
  return null;
};

/** On-chain transfers show only with an on-chain operator configured. */
export const OnchainTransfersSync = () =>
  onchainOperator !== null ? <OnchainTransfersViews /> : null;
