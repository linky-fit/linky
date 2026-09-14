import { useCallback, useRef } from "react";
import type { CashuOperationId } from "../../../evolu";
import type { Translate } from "../../../i18n";
import type { CashuTransferLifecycle } from "../composition/useLinkshuComposition";

interface UseReclaimCashuTransferParams {
  busy: boolean;
  enqueueCashuOp: (op: () => Promise<void>) => Promise<void>;
  reclaim: CashuTransferLifecycle["reclaim"] | null;
  setCashuIsBusy: (busy: boolean) => void;
  pushToast: (message: string) => void;
  t: Translate;
}

export const useReclaimCashuTransfer = ({
  busy,
  enqueueCashuOp,
  reclaim,
  setCashuIsBusy,
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
        await enqueueCashuOp(async () => {
          setCashuIsBusy(true);
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
            pushToast(`${t("errorPrefix")}: ${String(error)}`);
          } finally {
            setCashuIsBusy(false);
          }
        });
      } finally {
        running.current = false;
      }
    },
    [busy, enqueueCashuOp, reclaim, setCashuIsBusy, pushToast, t],
  );
};
