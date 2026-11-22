import type { MeltResumeResult, StoredOperation } from "@linky-fit/linkshu";
import type {
  TransactionRecord,
  TransactionsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { useDocumentVisible } from "../../../hooks/useDocumentVisible";
import { useLatest } from "../../../hooks/useLatest";
import { useOnline } from "../../../hooks/useOnline";
import type { Translate } from "../../../i18n";
import {
  isPendingTransactionOf,
  reportMeltHistoryResolved,
  settledMeltOfOperation,
  settledMeltOfResult,
  type SettledMelt,
} from "../../lib/meltRecovery";
import type { ResumePendingCashuMelts } from "../composition/useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

const FAST_CHECK_MS = 3_000;
const FAST_PHASE_MS = 60_000;
const SLOW_CHECK_MS = 30_000;

interface UseMeltRecoveryParams {
  /** Live wallet operations: pending melts keep the checks running. */
  operations: ReadonlyArray<StoredOperation>;
  pushToast: (message: string) => void;
  /** Live transaction rows. */
  records: ReadonlyArray<TransactionRecord>;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  t: Translate;
  transactions: Pick<TransactionsRepository, "update">;
}

const isSettled = (melt: SettledMelt | null): melt is SettledMelt =>
  melt !== null;

/**
 * Settles Lightning payments the mint had not answered when they were made.
 * `Melt.resumePending` runs when the runtime comes up, whenever the browser
 * comes back online, and while the page is visible and online and a melt is
 * pending: every 3 s for the first minute after a new pending melt appears
 * or the page returns, then every 30 s. One pass runs at a time. Each pass
 * updates every `pending` transaction whose melt is settled — by this pass,
 * with amount and fee, or already closed by an earlier pass or another
 * device, with amount only — and a pending row whose melt is already closed
 * starts a pass of its own.
 */
export const useMeltRecovery = ({
  operations,
  pushToast,
  records,
  resumePendingCashuMelts,
  t,
  transactions,
}: UseMeltRecoveryParams): void => {
  const settleHistory = React.useCallback(
    async (results: ReadonlyArray<MeltResumeResult>) => {
      const fromResults = results.map(settledMeltOfResult).filter(isSettled);
      // Results first: they carry the fee an already-closed operation lacks.
      const settled = [
        ...fromResults,
        ...operations.map(settledMeltOfOperation).filter(isSettled),
      ];
      for (const row of records) {
        if (row.status !== "pending") continue;
        const match = settled.find((melt) => isPendingTransactionOf(row, melt));
        if (match === undefined) continue;
        try {
          await Effect.runPromise(transactions.update(row.id, match.patch));
        } catch (error) {
          console.warn("[linky][melt] history update failed", error);
          continue;
        }
        reportMeltHistoryResolved({
          quoteId: match.quoteId,
          status: match.patch.status,
          transactionId: row.id,
        });
      }
      for (const { patch } of fromResults) {
        pushToast(
          t(patch.status === "ok" ? "payPendingPaid" : "payPendingFailed"),
        );
      }
    },
    [operations, pushToast, records, t, transactions],
  );

  // Read through a ref so new rows or a new translation do not start a pass.
  const settleHistoryRef = useLatest(settleHistory);
  const passRef = React.useRef<Promise<void> | null>(null);
  const pass = React.useMemo(() => {
    if (resumePendingCashuMelts === null) return null;
    return (): Promise<void> => {
      passRef.current ??= resumePendingCashuMelts()
        .then((results) => settleHistoryRef.current(results))
        .catch((error: unknown) => {
          console.warn("[linky][melt] resumePending failed", error);
        })
        .finally(() => {
          passRef.current = null;
        });
      return passRef.current;
    };
  }, [resumePendingCashuMelts, settleHistoryRef]);

  useResumeOnLaunchAndOnline(pass);

  const watchKey = React.useMemo(() => {
    const closed = operations.map(settledMeltOfOperation).filter(isSettled);
    const pendingMelts = operations
      .filter(({ kind, status }) => kind === "melt" && status === "pending")
      .map(({ id }) => id);
    const staleRows = records
      .filter(
        (row) =>
          row.status === "pending" &&
          closed.some((melt) => isPendingTransactionOf(row, melt)),
      )
      .map(({ id }) => id);
    return [...pendingMelts, ...staleRows].sort().join(",");
  }, [operations, records]);

  const visible = useDocumentVisible();
  const online = useOnline();
  const watching = watchKey !== "" && visible && online;
  React.useEffect(() => {
    if (!watching || pass === null) return;
    const fastUntil = Date.now() + FAST_PHASE_MS;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (): void => {
      void pass().then(() => {
        if (cancelled) return;
        timer = setTimeout(
          check,
          Date.now() < fastUntil ? FAST_CHECK_MS : SLOW_CHECK_MS,
        );
      });
    };
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pass, watchKey, watching]);
};
