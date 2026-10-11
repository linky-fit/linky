import { useCallback, useRef } from "react";
import type { RunQueuedTask } from "../../state/wallet/opQueue";
import type { CashuOperationId } from "../../../evolu";
import type { Translate } from "../../../i18n";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type { CashuTransferLifecycle } from "../composition/useLinkshuComposition";

interface UseReclaimCashuTransferParams {
  busy: boolean;
  reclaim: CashuTransferLifecycle["reclaim"] | null;
  runQueued: RunQueuedTask;
  pushToast: (message: string) => void;
  t: Translate;
}

export const useReclaimCashuTransfer = ({
  busy,
  reclaim,
  runQueued,
  pushToast,
  t,
}: UseReclaimCashuTransferParams) => {
  const running = useRef(false);
  return useCallback(
    async (id: CashuOperationId) => {
      if (busy || running.current) return;
      if (reclaim === null) {
        pushToast(t("seedMissing"));
        return;
      }
      running.current = true;
      try {
        await runQueued(async () => {
          try {
            const report = await reclaim(id);
            const message =
              report.unresolvedProofs.length > 0
                ? "cashuReclaimIncomplete"
                : report.reclaimedProofs.length > 0
                  ? "cashuReclaimDone"
                  : report.spentProofs.length > 0
                    ? "cashuTokenClaimed"
                    : "cashuNoProofs";
            pushToast(
              t(message)
                .replace("{amount}", String(report.reclaimedAmount))
                .replace("{proofs}", String(report.reclaimedProofs.length)),
            );
          } catch (error) {
            pushToast(
              `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "unknown")}`,
            );
          }
        });
      } finally {
        running.current = false;
      }
    },
    [busy, reclaim, runQueued, pushToast, t],
  );
};
