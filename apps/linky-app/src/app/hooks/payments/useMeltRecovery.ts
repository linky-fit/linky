import type { MeltResumeResult } from "@linky-fit/linkshu";
import {
  transactionIdForOperation,
  type TransactionsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useDocumentVisible } from "../../../hooks/useDocumentVisible";
import { useLatest } from "../../../hooks/useLatest";
import { useOnline } from "../../../hooks/useOnline";
import type { Translate } from "../../../i18n";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import {
  meltTransactionPatch,
  readMeltQuoteIdFromDetailsJson,
  reportMeltHistoryResolved,
} from "../../lib/meltRecovery";
import type { RunQueuedTask } from "../../state/wallet/opQueue";
import type { ResumePendingCashuMelts } from "../composition/useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

/** Past linkshu's in-line wait on a PENDING melt (~3.5 s), so the first re-check reaches the mint. */
export const FIRST_RECHECK_MS = 5_000;
export const MAX_RECHECK_MS = 60_000;
const RECHECK_BACKOFF = 1.5;

type RecheckTrigger = "launchOrOnline" | "timer" | "visible";

interface UseMeltRecoveryParams {
  /** Ids of the `pending` melt operations; re-checks run only while there are some. */
  pendingMeltIds: ReadonlyArray<string>;
  pushToast: (message: string) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuMelts: ResumePendingCashuMelts | null;
  runQueued: RunQueuedTask;
  t: Translate;
  transactions: Pick<TransactionsRepository, "all" | "update">;
}

/**
 * Settles Lightning payments the mint had not answered when they were made:
 * `Melt.resumePending` runs when the runtime comes up, whenever the browser
 * comes back online, and while a melt is pending also when the page becomes
 * visible and on a backoff (5 s growing to 1 min) as long as the page stays
 * visible and online. One pass runs at a time, as a background task in the
 * wallet queue, so it never blocks or drops a user payment; linkshu leaves a
 * melt that is still being paid alone. Every settled result updates the
 * `pending` transaction that carries its melt quote id — paid with amount
 * and fee, or failed. Unsettled records stay pending until a later pass.
 */
export const useMeltRecovery = ({
  pendingMeltIds,
  pushToast,
  resumePendingCashuMelts,
  runQueued,
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
        const match = settled.find(
          ({ result }) =>
            row.id === transactionIdForOperation(result.operationId) ||
            (result.quoteId === quoteId && String(result.mint) === row.mint),
        );
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

  // Read through refs so a new translation or pending list does not start
  // another pass.
  const settleHistoryRef = useLatest(settleHistory);
  const pendingMeltIdsRef = useLatest(pendingMeltIds);
  const passRef = React.useRef<Promise<void> | null>(null);
  const resume = React.useMemo(() => {
    if (resumePendingCashuMelts === null) return null;
    return (trigger: RecheckTrigger = "launchOrOnline"): Promise<void> => {
      if (passRef.current !== null) return passRef.current;
      const operation = [...pendingMeltIdsRef.current];
      reportAppLog({
        tag: "melt.recheckPending",
        summary: `Re-checking ${operation.length} pending Lightning payment(s) (${trigger})`,
        links: { operation },
        payload: { trigger, pendingMelts: operation.length },
      });
      passRef.current = runQueued(resumePendingCashuMelts, {
        background: true,
      })
        .then((results) => settleHistoryRef.current(results))
        .catch((error: unknown) => {
          reportAppLog({
            tag: "melt.resumePendingRejected",
            summary: "A pass over unsettled Lightning payments stopped early",
            payload: {
              error: getUnknownErrorMessage(error, "resumePending failed"),
            },
          });
        })
        .finally(() => {
          passRef.current = null;
        });
      return passRef.current;
    };
  }, [pendingMeltIdsRef, resumePendingCashuMelts, runQueued, settleHistoryRef]);

  useResumeOnLaunchAndOnline(resume);

  const pendingKey = [...pendingMeltIds].sort().join(",");
  const visible = useDocumentVisible();
  const online = useOnline();
  const watching =
    pendingKey !== "" && visible && online && resumePendingCashuMelts !== null;

  const wasVisibleRef = React.useRef(visible);
  React.useEffect(() => {
    const cameBack = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (cameBack && watching) void resume?.("visible");
  }, [resume, visible, watching]);

  // A new pending melt or a return to the page starts the backoff over.
  React.useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    let delay = FIRST_RECHECK_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = (): void => {
      timer = setTimeout(() => {
        delay = Math.min(delay * RECHECK_BACKOFF, MAX_RECHECK_MS);
        void resume?.("timer").then(() => {
          if (!cancelled) scheduleNext();
        });
      }, delay);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingKey, resume, watching]);
};
