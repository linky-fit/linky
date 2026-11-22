import type { StoredOperation } from "@linky-fit/linkshu";
import type { TransactionsRepository } from "@linky-fit/linksync";
import React from "react";
import type { Translate } from "../../../i18n";
import { drainLegacyAcceptedCashuToken } from "../../migrations/legacyAcceptedTokenDrain";
import type {
  ReceiveCashuToken,
  ResumePendingCashuAutoswapClaims,
  ResumePendingCashuMelts,
} from "../../state/linkshu/commands";
import { useMeltRecovery } from "../payments/useMeltRecovery";
import { useTransactionRecords } from "../useLinksync";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

interface UseWalletResumesParams {
  operations: ReadonlyArray<StoredOperation>;
  pushToast: (message: string) => void;
  receiveCashuToken: ReceiveCashuToken | null;
  resumePendingCashuAutoswapClaims: ResumePendingCashuAutoswapClaims | null;
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  t: Translate;
  transactions: Pick<TransactionsRepository, "update">;
}

/** Finishes wallet work an earlier session left: mint move claims, unsettled melts, a legacy token. */
export const useWalletResumes = ({
  operations,
  pushToast,
  receiveCashuToken,
  resumePendingCashuAutoswapClaims,
  resumePendingCashuMelts,
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

  const records = useTransactionRecords();
  useMeltRecovery({
    operations,
    pushToast,
    records,
    resumePendingCashuMelts,
    t,
    transactions,
  });
};
