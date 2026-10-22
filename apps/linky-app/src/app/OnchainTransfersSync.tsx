import { useExperimentalFeatures } from "./hooks/useExperimentalFeatures";
import { useOnchainTransfersSync } from "./hooks/useOnchainTransfers";
import { onchainOperator } from "./lib/onchainOperator";

const OnchainTransfersViews = (): null => {
  useOnchainTransfersSync();
  return null;
};

/** On-chain transfers show only with experimental features on and an on-chain operator configured. */
export const OnchainTransfersSync = () => {
  const { experimentalFeatures } = useExperimentalFeatures();
  return experimentalFeatures && onchainOperator !== null ? (
    <OnchainTransfersViews />
  ) : null;
};
