import type { MeltResumeResult } from "@linky/linkshu";
import type { TransactionsRepository } from "@linky/linksync";
import { Effect } from "effect";
import React from "react";
import type { Translate } from "../../../i18n";
import {
  meltTransactionPatch,
  readMeltQuoteIdFromDetailsJson,
  reportMeltHistoryResolved,
} from "../../lib/meltRecovery";
import type { ResumePendingCashuMelts } from "../composition/useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

interface UseMeltRecoveryParams {
  pushToast: (message: string) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  t: Translate;
  transactions: Pick<TransactionsRepository, "all" | "update">;
}

/**
 * Settles Lightning payments the mint had not answered when they were made:
 * `Melt.resumePending` runs when the runtime comes up and whenever the
 * browser comes back online, and every settled result updates the `pending`
 * transaction that carries its melt quote id — paid with amount and fee, or
 * failed. Unsettled records stay pending until a later pass.
 */
export const useMeltRecovery = ({
  pushToast,
  resumePendingCashuMelts,
  t,
  transactions,
}: UseMeltRecoveryParams): void => {
  const settleHistory = React.useCallback(
    async (results: ReadonlyArray<MeltResumeResult>) => {
      const settled = results.flatMap((result) => {
        const patch = meltTransactionPatch(result);
        return patch === null ? [] : [{ patch, result }];
      });
      if (settled.length === 0) return;

      const records = await Effect.runPromise(transactions.all);
      for (const row of records) {
        if (row.status !== "pending") continue;
        const quoteId = readMeltQuoteIdFromDetailsJson(row.detailsJson);
        const match = settled.find((entry) => entry.result.quoteId === quoteId);
        if (match === undefined) continue;
        await Effect.runPromise(transactions.update(row.id, match.patch));
        reportMeltHistoryResolved({
          quoteId: match.result.quoteId,
          status: match.patch.status,
          transactionId: row.id,
        });
      }
      for (const { patch } of settled) {
        pushToast(
          t(patch.status === "ok" ? "payPendingPaid" : "payPendingFailed"),
        );
      }
    },
    [pushToast, t, transactions],
  );

  useResumeOnLaunchAndOnline(
    React.useMemo(() => {
      if (resumePendingCashuMelts === null) return null;
      return () => {
        void resumePendingCashuMelts()
          .then(settleHistory)
          .catch((error: unknown) => {
            console.warn("[linky][melt] resumePending failed", error);
          });
      };
    }, [resumePendingCashuMelts, settleHistory]),
  );
};
