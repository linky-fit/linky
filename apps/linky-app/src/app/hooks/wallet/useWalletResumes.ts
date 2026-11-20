import type { TransactionsRepository } from "@linky-fit/linksync";
import React from "react";
import type { Translate } from "../../../i18n";
import { drainLegacyAcceptedCashuToken } from "../../migrations/legacyAcceptedTokenDrain";
import type {
  ReceiveCashuToken,
  ResumePendingCashuAutoswapClaims,
  ResumePendingCashuMelts,
} from "../../state/linkshu/commands";
import type { RunQueuedTask } from "../../state/wallet/opQueue";
import { useMeltRecovery } from "../payments/useMeltRecovery";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

interface UseWalletResumesParams {
  pendingMeltIds: ReadonlyArray<string>;
  pushToast: (message: string) => void;
  receiveCashuToken: ReceiveCashuToken | null;
  resumePendingCashuAutoswapClaims: ResumePendingCashuAutoswapClaims | null;
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  runQueued: RunQueuedTask;
  t: Translate;
  transactions: Pick<TransactionsRepository, "all" | "update">;
}

/** Finishes wallet work an earlier session left: mint move claims, unsettled melts, a legacy token. */
export const useWalletResumes = ({
  pendingMeltIds,
  pushToast,
  receiveCashuToken,
  resumePendingCashuAutoswapClaims,
  resumePendingCashuMelts,
  runQueued,
  t,
  transactions,
}: UseWalletResumesParams) => {
  // Legacy migration; removal gate in app/migrations/AGENTS.md
  React.useEffect(() => {
    if (receiveCashuToken === null) return;
    void drainLegacyAcceptedCashuToken(receiveCashuToken);
  }, [receiveCashuToken]);

  useResumeOnLaunchAndOnline(
    React.useMemo(() => {
      if (resumePendingCashuAutoswapClaims === null) return null;
      return () => {
        void resumePendingCashuAutoswapClaims().catch((error: unknown) => {
          console.warn("[linky][autoswap] resumePendingClaims failed", error);
        });
      };
    }, [resumePendingCashuAutoswapClaims]),
  );

  useMeltRecovery({
    pendingMeltIds,
    pushToast,
    resumePendingCashuMelts,
    runQueued,
    t,
    transactions,
  });
};
