import type { AutoswapEstimate } from "@linky/linkshu";
import { Either } from "effect";
import React from "react";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { formatMintHost, normalizeMintUrl } from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import type {
  AutoswapCashu,
  EstimateAutoswapCashu,
} from "../composition/useLinkshuComposition";

export interface MintMove {
  readonly sourceMint: string;
  readonly targetMint: string;
  /** What arrives at the target mint; absent sweeps the whole balance. */
  readonly amountSat?: number;
}

interface UseMoveMintFundsParams {
  autoswapCashu: AutoswapCashu | null;
  cashuIsBusy: boolean;
  estimateAutoswapCashu: EstimateAutoswapCashu | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

const describeError = (error: unknown): string =>
  describeTaggedCashuError(error) ?? getUnknownErrorMessage(error, "unknown");

/** Moving funds between mints (linkshu Autoswap), priced first. */
export const useMoveMintFunds = ({
  autoswapCashu,
  cashuIsBusy,
  estimateAutoswapCashu,
  formatDisplayedAmountParts,
  rememberSeenMint,
  setCashuIsBusy,
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
      if (estimateAutoswapCashu === null) {
        setStatus(t("mintMoveUnavailable"));
        return null;
      }
      try {
        const outcome = await estimateAutoswapCashu(move);
        if (Either.isRight(outcome)) return outcome.right;
        setStatus(
          `${t("mintMoveEstimateFailed")}: ${describeError(outcome.left)}`,
        );
      } catch (error) {
        setStatus(`${t("mintMoveEstimateFailed")}: ${describeError(error)}`);
      }
      return null;
    },
    [estimateAutoswapCashu, setStatus, t],
  );

  /** Resolves true once the funds left the source (arrived, or claim pending). */
  const moveMintFunds = React.useCallback(
    async (move: MintMove): Promise<boolean> => {
      if (cashuIsBusy) return false;
      if (autoswapCashu === null) {
        setStatus(t("mintMoveUnavailable"));
        return false;
      }
      setCashuIsBusy(true);
      setStatus(t("mintMoveProcessing"));
      try {
        rememberSeenMint(move.targetMint);
        const outcome = await autoswapCashu(move);
        if (Either.isRight(outcome)) {
          setStatus(
            t("mintMoveDone")
              .replace("{amount}", formatAmount(outcome.right.movedAmount))
              .replace("{mint}", formatMintHost(move.targetMint))
              .replace("{fee}", formatAmount(outcome.right.feePaid)),
          );
          return true;
        }
        const error = outcome.left;
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
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      autoswapCashu,
      cashuIsBusy,
      formatAmount,
      rememberSeenMint,
      setCashuIsBusy,
      setStatus,
      t,
    ],
  );

  return { estimateMintMove, moveMintFunds };
};
