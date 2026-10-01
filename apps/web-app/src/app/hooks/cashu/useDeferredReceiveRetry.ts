import type { DeferredReceiveResult } from "@linky-fit/linkshu";
import { transactionIdForOperation } from "@linky-fit/linksync";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { useLatest } from "../../../hooks/useLatest";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import { touchReceivingMint } from "../../lib/receivingMint";
import type { ReceivingMintBookkeeping } from "../../lib/receivingMint";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import type { ResumeDeferredCashuReceives } from "../composition/useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;

interface UseDeferredReceiveRetryParams extends ReceivingMintBookkeeping {
  /** Pending deferred receives; the backoff timer runs only while there are some. */
  deferredCount: number;
  enqueueCashuOp: <T>(op: () => Promise<T>) => Promise<T>;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  rememberCashuTokenKnown: (...tokens: readonly string[]) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumeDeferredCashuReceives: ResumeDeferredCashuReceives | null;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  t: Translate;
}

/**
 * Receives tokens kept because their mint could not be used: linkshu
 * `Receive.resumeDeferred` runs once startup network work may begin
 * (`useDeferredOnlineReady`), whenever the browser comes back online, and on
 * a backoff (30 s doubling to 10 min) while deferrals stay pending. One pass
 * runs at a time, in the wallet queue like every other receive. Tokens that
 * land are announced like a live receive, with one overlay for the pass's sat
 * total; any other outcome reaches only the inspector (a swap that failed
 * transiently leaves a failed receive, which the next launch resumes as
 * quietly: chat auto-accept when a message carries the token, and
 * `useInterruptedReceiveRecovery` otherwise).
 */
export const useDeferredReceiveRetry = ({
  deferredCount,
  enqueueCashuOp,
  formatDisplayedAmountParts,
  isMintDeleted,
  logPaymentEvent,
  mintInfoByUrl,
  refreshMintInfo,
  rememberCashuTokenKnown,
  resumeDeferredCashuReceives,
  showPaidOverlay,
  t,
  touchMintInfo,
}: UseDeferredReceiveRetryParams): void => {
  const announceReceived = React.useCallback(
    (results: ReadonlyArray<DeferredReceiveResult>) => {
      const receipts = results.flatMap(({ receipt }) =>
        receipt === null ? [] : [receipt],
      );
      for (const receipt of receipts) {
        rememberCashuTokenKnown(receipt.tokenText);
        touchReceivingMint(receipt.mint, {
          isMintDeleted,
          mintInfoByUrl,
          refreshMintInfo,
          touchMintInfo,
        });
        logPaymentEvent({
          direction: "in",
          status: "ok",
          transactionId: transactionIdForOperation(receipt.operationId),
          amount: receipt.amount,
          contactId: null,
          details: { acceptedToken: receipt.tokenText },
          fee: null,
          mint: receipt.mint,
          unit: receipt.unit,
          error: null,
          method: "cashu_receive",
          phase: "receive",
        });
      }
      // The overlay shows sat, like the wallet's other totals.
      const satReceipts = receipts.filter(({ unit }) => unit === "sat");
      if (satReceipts.length === 0) return;
      const total = satReceipts.reduce((sum, { amount }) => sum + amount, 0);
      const amount = formatDisplayedAmountParts(total);
      showPaidOverlay(
        t("paidReceived")
          .replace("{amount}", `${amount.approxPrefix}${amount.amountText}`)
          .replace("{unit}", amount.unitLabel),
        { direction: "in", amountSat: total },
      );
    },
    [
      formatDisplayedAmountParts,
      isMintDeleted,
      logPaymentEvent,
      mintInfoByUrl,
      refreshMintInfo,
      rememberCashuTokenKnown,
      showPaidOverlay,
      t,
      touchMintInfo,
    ],
  );

  // Read through a ref so a new translation or amount format does not start
  // another pass.
  const announceReceivedRef = useLatest(announceReceived);
  const onlineReady = useDeferredOnlineReady();
  const passRef = React.useRef<Promise<void> | null>(null);
  const resume = React.useMemo(() => {
    if (!onlineReady || resumeDeferredCashuReceives === null) return null;
    return (): Promise<void> => {
      passRef.current ??= enqueueCashuOp(resumeDeferredCashuReceives)
        .then((results) => announceReceivedRef.current(results))
        .catch((error: unknown) => {
          reportAppLog({
            tag: "receive.resumeDeferredRejected",
            summary: "A retry of tokens kept for their mint stopped early",
            payload: {
              error: getUnknownErrorMessage(error, "resumeDeferred failed"),
            },
          });
        })
        .finally(() => {
          passRef.current = null;
        });
      return passRef.current;
    };
  }, [
    announceReceivedRef,
    enqueueCashuOp,
    onlineReady,
    resumeDeferredCashuReceives,
  ]);

  useResumeOnLaunchAndOnline(resume);

  const hasDeferred = deferredCount > 0;
  React.useEffect(() => {
    if (!hasDeferred || resume === null) return;
    let cancelled = false;
    let delay = FIRST_RETRY_MS;
    let timer: number | undefined;
    const scheduleNext = (): void => {
      timer = window.setTimeout(() => {
        delay = Math.min(delay * 2, MAX_RETRY_MS);
        void resume().then(() => {
          if (!cancelled) scheduleNext();
        });
      }, delay);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasDeferred, resume]);
};
