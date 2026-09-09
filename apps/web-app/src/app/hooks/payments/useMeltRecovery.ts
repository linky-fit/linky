import * as Evolu from "@evolu/common";
import type { MeltResumeResult } from "@linky/linkshu";
import React from "react";
import { evolu, type TransactionId } from "../../../evolu";
import type { Translate } from "../../../i18n";
import {
  meltTransactionPatch,
  readMeltQuoteIdFromDetailsJson,
  reportMeltHistoryResolved,
} from "../../lib/meltRecovery";
import type { MeltTransactionPatch } from "../../lib/meltRecovery";
import type { ResumePendingCashuMelts } from "../composition/useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

/** The slice of Evolu's `update` mutation this hook writes through. */
type UpdateTransaction = (
  table: "transaction",
  payload: MeltTransactionPatch & { readonly id: TransactionId },
  options?: { readonly ownerId: Evolu.OwnerId },
) => unknown;

interface UseMeltRecoveryParams {
  pushToast: (message: string) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  t: Translate;
  transactionsOwnerId: Evolu.OwnerId | null;
  update: UpdateTransaction;
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
  transactionsOwnerId,
  update,
}: UseMeltRecoveryParams): void => {
  const pendingTransactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("transaction")
          .select(["id", "ownerId", "detailsJson"])
          .where("status", "=", Evolu.NonEmptyString100.orThrow("pending"))
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const settleHistory = React.useCallback(
    async (results: ReadonlyArray<MeltResumeResult>) => {
      const settled = results.flatMap((result) => {
        const patch = meltTransactionPatch(result);
        return patch === null ? [] : [{ patch, result }];
      });
      if (settled.length === 0) return;

      const rows = await evolu.loadQuery(pendingTransactionsQuery);
      for (const row of rows) {
        const quoteId = readMeltQuoteIdFromDetailsJson(row.detailsJson);
        const match = settled.find((entry) => entry.result.quoteId === quoteId);
        if (match === undefined) continue;
        const rowOwnerId = Evolu.OwnerId.fromUnknown(row.ownerId);
        const ownerId = rowOwnerId.ok ? rowOwnerId.value : transactionsOwnerId;
        const payload = { id: row.id, ...match.patch };
        if (ownerId) {
          update("transaction", payload, { ownerId });
        } else {
          update("transaction", payload);
        }
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
    [pendingTransactionsQuery, pushToast, t, transactionsOwnerId, update],
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
