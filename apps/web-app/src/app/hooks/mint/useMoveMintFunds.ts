import type { AutoswapEstimate } from "@linky-fit/linkshu";
import { Option, Result } from "effect";
import React from "react";
import type { RunExclusiveTask } from "../../state/wallet/opQueue";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { formatMintHost, normalizeMintUrl } from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import type {
  AutoswapCashu,
  EstimateAutoswapCashu,
  ResolveAutoswapSource,
} from "../composition/useLinkshuComposition";

export interface MintMove {
  readonly sourceMint: string;
  readonly targetMint: string;
  /** What arrives at the target mint; absent sweeps the whole balance. */
  readonly amountSat?: number;
}

interface UseMoveMintFundsParams {
  autoswapCashu: AutoswapCashu | null;
  estimateAutoswapCashu: EstimateAutoswapCashu | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
  resolveAutoswapSource: ResolveAutoswapSource | null;
  runExclusive: RunExclusiveTask;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

const describeError = (error: unknown): string =>
  describeTaggedCashuError(error) ?? getUnknownErrorMessage(error, "unknown");

/**
 * Moving funds between mints (linkshu Autoswap), priced first. The estimate
 * resolves the source to its stored spelling; the move takes the source the
 * estimate priced, so both draw from one spelling.
 */
export const useMoveMintFunds = ({
  autoswapCashu,
  estimateAutoswapCashu,
  formatDisplayedAmountParts,
  rememberSeenMint,
  resolveAutoswapSource,
  runExclusive,
  setStatus,
  t,
}: UseMoveMintFundsParams) => {
  const formatAmount = React.useCallback(
    (amountSat: number): string => {
      const parts = formatDisplayedAmountParts(amountSat);
      return `${parts.approxPrefix}${parts.amountText} ${parts.unitLabel}`;
    },
    [formatDisplayedAmountParts],
  );

  const estimateMintMove = React.useCallback(
    async (move: MintMove): Promise<AutoswapEstimate | null> => {
      if (estimateAutoswapCashu === null || resolveAutoswapSource === null) {
        setStatus(t("mintMoveUnavailable"));
        return null;
      }
      try {
        const outcome = await estimateAutoswapCashu({
          ...move,
          sourceMint: await resolveAutoswapSource(move.sourceMint),
        });
        if (Result.isSuccess(outcome)) return outcome.success;
        setStatus(
          `${t("mintMoveEstimateFailed")}: ${describeError(outcome.failure)}`,
        );
      } catch (error) {
        setStatus(`${t("mintMoveEstimateFailed")}: ${describeError(error)}`);
      }
      return null;
    },
    [estimateAutoswapCashu, resolveAutoswapSource, setStatus, t],
  );

  /**
   * Moves from `move.sourceMint` as given, the spelling its estimate priced.
   * Resolves true once the funds left the source (arrived, or claim pending).
   */
  const moveMintFunds = React.useCallback(
    async (move: MintMove): Promise<boolean> => {
      if (autoswapCashu === null) {
        setStatus(t("mintMoveUnavailable"));
        return false;
      }
      const moved = await runExclusive(async (): Promise<boolean> => {
        setStatus(t("mintMoveProcessing"));
        try {
          rememberSeenMint(move.targetMint);
          const outcome = await autoswapCashu(move);
          if (Result.isSuccess(outcome)) {
            setStatus(
              t("mintMoveDone")
                .replace("{amount}", formatAmount(outcome.success.movedAmount))
                .replace("{mint}", formatMintHost(move.targetMint))
                .replace("{fee}", formatAmount(outcome.success.feePaid)),
            );
            return true;
          }
          const error = outcome.failure;
          // The melt paid the target's invoice; the pending claim finishes it.
          if (
            error._tag === "PaymentFailed" &&
            normalizeMintUrl(error.mint) === normalizeMintUrl(move.targetMint)
          ) {
            setStatus(t("mintMovePending"));
            return true;
          }
          setStatus(`${t("mintMoveFailed")}: ${describeError(error)}`);
          return false;
        } catch (error) {
          setStatus(`${t("mintMoveFailed")}: ${describeError(error)}`);
          return false;
        }
      });
      return Option.getOrElse(moved, () => false);
    },
    [autoswapCashu, formatAmount, rememberSeenMint, runExclusive, setStatus, t],
  );

  return { estimateMintMove, moveMintFunds };
};
