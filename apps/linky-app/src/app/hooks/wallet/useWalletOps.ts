import { useAtomValue } from "@linky-fit/linkstr-react";
import { walletOpRunningAtom, walletOpsAtom } from "../../state/wallet/opQueue";

/**
 * The page's wallet operation queue (`WalletOps`) for screens and hooks:
 * whether an operation runs, and promise runners.
 */
export const useWalletOps = () => {
  const ops = useAtomValue(walletOpsAtom);
  const walletOpRunning = useAtomValue(walletOpRunningAtom);
  return {
    runExclusive: ops.runExclusiveTask,
    runQueued: ops.runQueuedTask,
    walletOpRunning,
  };
};
