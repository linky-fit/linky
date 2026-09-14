import type { ReceiveReceipt, TokenTransfer } from "@linky/linkshu";
import { Either } from "effect";
import type { Dispatch, SetStateAction } from "react";
import React from "react";
import type { Translate } from "../../../i18n";
import { nowSeconds } from "../../../utils/time";
import { reportCashuUnclaimedReturned } from "../../lib/cashuSendInspector";
import { isIssuedTransfer } from "../../lib/cashuTransfers";

export type UnclaimedReturnReason = "manual" | "auto";

export interface ReturnUnclaimedTokensOptions {
  reason: UnclaimedReturnReason;
  /** Only sends issued at least this many seconds ago; every issued send when omitted. */
  olderThanSec?: number;
}

export interface ReturnUnclaimedTokensReport {
  /** Sends re-received into the balance. */
  returned: number;
  returnedAmount: number;
  /** Sends the recipient had already redeemed; they closed as claimed. */
  claimed: number;
  /** Sends the mint rejected for another reason; they stay issued. */
  failed: number;
  /** The pass stopped early because the mint was not answering. */
  mintUnreachable: boolean;
}

type ReturnOutcome = Either.Either<ReceiveReceipt, { readonly _tag: string }>;

interface UseReturnUnclaimedTokensParams {
  cashuIsBusy: boolean;
  cashuOpenTransfers: readonly TokenTransfer[];
  /** Closes issued sends the mint reports fully spent; null until the runtime is ready. */
  checkIssuedClaims:
    | (() => Promise<{ claimed: ReadonlyArray<{ id: string }> }>)
    | null;
  enqueueCashuOp: (op: () => Promise<void>) => Promise<void>;
  formatDisplayedAmountText: (amount: number) => string;
  pushToast: (message: string) => void;
  /** Re-receives one handed-out token; null until the runtime is ready. */
  returnToWallet: ((operationId: string) => Promise<ReturnOutcome>) | null;
  setCashuIsBusy: Dispatch<SetStateAction<boolean>>;
  setTokensReturnIsBusy: Dispatch<SetStateAction<boolean>>;
  t: Translate;
  tokensReturnIsBusy: boolean;
}

const EMPTY_REPORT: ReturnUnclaimedTokensReport = {
  returned: 0,
  returnedAmount: 0,
  claimed: 0,
  failed: 0,
  mintUnreachable: false,
};

/** Failures after which the remaining sends would fail the same way. */
const STOP_PASS_TAGS: ReadonlySet<string> = new Set([
  "MintUnreachable",
  "CounterLockTimeout",
]);

export const selectUnclaimedCandidates = (
  transfers: readonly TokenTransfer[],
  olderThanSec: number | undefined,
  now: number,
): TokenTransfer[] => {
  const cutoff = olderThanSec === undefined ? null : now - olderThanSec;
  return transfers.filter(
    (transfer) =>
      isIssuedTransfer(transfer) &&
      (cutoff === null || transfer.createdAt <= cutoff),
  );
};

/**
 * Returns every issued send nobody claimed back into the balance, in one
 * pass over `returnToWallet`. The mint is asked first so a token the
 * recipient already redeemed closes as claimed instead of being re-received.
 * A manual pass always reports; an automatic one stays quiet unless it
 * actually moved funds, because it runs every minute.
 */
export const useReturnUnclaimedTokens = ({
  cashuIsBusy,
  cashuOpenTransfers,
  checkIssuedClaims,
  enqueueCashuOp,
  formatDisplayedAmountText,
  pushToast,
  returnToWallet,
  setCashuIsBusy,
  setTokensReturnIsBusy,
  t,
  tokensReturnIsBusy,
}: UseReturnUnclaimedTokensParams) => {
  return React.useCallback(
    async (
      options: ReturnUnclaimedTokensOptions,
    ): Promise<ReturnUnclaimedTokensReport> => {
      if (tokensReturnIsBusy || cashuIsBusy) return EMPTY_REPORT;
      if (checkIssuedClaims === null || returnToWallet === null) {
        if (options.reason === "manual") pushToast(t("seedMissing"));
        return EMPTY_REPORT;
      }
      const eligible = selectUnclaimedCandidates(
        cashuOpenTransfers,
        options.olderThanSec,
        nowSeconds(),
      );
      if (eligible.length === 0) {
        if (options.reason === "manual") {
          pushToast(t("cashuReturnUnclaimedNothing"));
        }
        return EMPTY_REPORT;
      }

      let report = EMPTY_REPORT;
      await enqueueCashuOp(async () => {
        setTokensReturnIsBusy(true);
        setCashuIsBusy(true);
        try {
          const alreadyClaimed = new Set(
            (await checkIssuedClaims()).claimed.map((entry) => entry.id),
          );
          const candidates = eligible.filter(
            (transfer) => !alreadyClaimed.has(String(transfer.id)),
          );
          const tally = {
            ...EMPTY_REPORT,
            claimed: eligible.length - candidates.length,
          };
          const returnedIds: string[] = [];
          for (const transfer of candidates) {
            const outcome = await returnToWallet(String(transfer.id));
            if (Either.isRight(outcome)) {
              tally.returned += 1;
              tally.returnedAmount += transfer.amount;
              returnedIds.push(String(transfer.id));
              continue;
            }
            const tag = outcome.left._tag;
            if (tag === "TokenAlreadySpent") {
              tally.claimed += 1;
              continue;
            }
            tally.failed += 1;
            if (STOP_PASS_TAGS.has(tag)) {
              tally.mintUnreachable = true;
              break;
            }
          }
          report = tally;
          reportCashuUnclaimedReturned({
            reason: options.reason,
            olderThanSec: options.olderThanSec ?? null,
            eligible: eligible.length,
            returned: tally.returned,
            returnedAmount: tally.returnedAmount,
            claimed: tally.claimed,
            failed: tally.failed,
            mintUnreachable: tally.mintUnreachable,
            operationIds: returnedIds,
          });
          const message = describeReport(tally, t, formatDisplayedAmountText);
          if (options.reason === "manual" || tally.returned > 0) {
            pushToast(message);
          }
        } finally {
          setCashuIsBusy(false);
          setTokensReturnIsBusy(false);
        }
      });
      return report;
    },
    [
      cashuIsBusy,
      cashuOpenTransfers,
      checkIssuedClaims,
      enqueueCashuOp,
      formatDisplayedAmountText,
      pushToast,
      returnToWallet,
      setCashuIsBusy,
      setTokensReturnIsBusy,
      t,
      tokensReturnIsBusy,
    ],
  );
};

const describeReport = (
  report: ReturnUnclaimedTokensReport,
  t: Translate,
  formatDisplayedAmountText: (amount: number) => string,
): string => {
  const parts: string[] = [];
  if (report.returned > 0) {
    parts.push(
      t("cashuReturnUnclaimedDone")
        .replace("{count}", String(report.returned))
        .replace("{amount}", formatDisplayedAmountText(report.returnedAmount)),
    );
  }
  if (report.claimed > 0) {
    parts.push(
      t("cashuReturnUnclaimedClaimed").replace(
        "{count}",
        String(report.claimed),
      ),
    );
  }
  if (report.failed > 0) {
    parts.push(
      t("cashuReturnUnclaimedFailed").replace("{count}", String(report.failed)),
    );
  }
  return parts.length > 0 ? parts.join(" ") : t("cashuReturnUnclaimedNothing");
};
