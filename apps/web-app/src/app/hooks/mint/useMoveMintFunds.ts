import { useAtomValue } from "@linky-fit/linkstr-react";
import type { AutoswapEstimate } from "@linky-fit/linkshu";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { formatMintHost } from "../../../utils/mint";
import {
  moveFundsCommandsAtom,
  type MintMove,
} from "../../state/wallet/moveFunds";
import { useDisplayAmounts, useSetStatus, useTranslation } from "../shell";

export type { MintMove } from "../../state/wallet/moveFunds";

/** Moving funds between mints (linkshu Autoswap), with its status lines. */
export const useMoveMintFunds = () => {
  const { formatDisplayedAmountParts } = useDisplayAmounts();
  const setStatus = useSetStatus();
  const { t } = useTranslation();
  const commands = Option.getOrNull(
    AsyncResult.value(useAtomValue(moveFundsCommandsAtom)),
  );
  const formatAmount = React.useCallback(
    (amountSat: number): string => {
      const parts = formatDisplayedAmountParts(amountSat);
      return `${parts.approxPrefix}${parts.amountText} ${parts.unitLabel}`;
    },
    [formatDisplayedAmountParts],
  );

  const estimateMintMove = React.useCallback(
    async (move: MintMove): Promise<AutoswapEstimate | null> => {
      if (commands === null) {
        setStatus(t("mintMoveUnavailable"));
        return null;
      }
      const outcome = await commands.estimateMintMove(move);
      switch (outcome._tag) {
        case "Estimated":
          return outcome.estimate;
        case "Unavailable":
          setStatus(t("mintMoveUnavailable"));
          return null;
        case "Failed":
          setStatus(`${t("mintMoveEstimateFailed")}: ${outcome.detail}`);
          return null;
      }
    },
    [commands, setStatus, t],
  );

  /** Resolves true once the funds left the source (arrived, or claim pending). */
  const moveMintFunds = React.useCallback(
    async (move: MintMove): Promise<boolean> => {
      if (commands === null) {
        setStatus(t("mintMoveUnavailable"));
        return false;
      }
      const outcome = await commands.moveMintFunds(move, {
        onStarted: () => setStatus(t("mintMoveProcessing")),
      });
      switch (outcome._tag) {
        case "Moved":
          setStatus(
            t("mintMoveDone")
              .replace("{amount}", formatAmount(outcome.receipt.movedAmount))
              .replace("{mint}", formatMintHost(move.targetMint))
              .replace("{fee}", formatAmount(outcome.receipt.feePaid)),
          );
          return true;
        case "ClaimPending":
          setStatus(t("mintMovePending"));
          return true;
        case "Unavailable":
          setStatus(t("mintMoveUnavailable"));
          return false;
        case "Busy":
          return false;
        case "Failed":
          setStatus(`${t("mintMoveFailed")}: ${outcome.detail}`);
          return false;
      }
    },
    [commands, formatAmount, setStatus, t],
  );

  /** "Move to default mint": sweeps the largest other mint, once the user confirmed. */
  const meltToDefaultMint = React.useCallback(async (): Promise<void> => {
    if (commands === null) {
      setStatus(t("cashuMeltToMainMintUnavailable"));
      return;
    }
    const outcome = await commands.meltToDefaultMint({
      onStarted: () => setStatus(t("cashuMeltToMainMintProcessing")),
    });
    const format = (amountSat: number) => {
      const parts = formatDisplayedAmountParts(amountSat);
      return (template: string) =>
        template
          .replace("{amount}", `${parts.approxPrefix}${parts.amountText}`)
          .replace("{unit}", parts.unitLabel);
    };
    switch (outcome._tag) {
      case "Moved":
        setStatus(
          format(outcome.movedAmount)(t("cashuMeltToMainMintDone")).replace(
            "{mint}",
            formatMintHost(outcome.targetMint),
          ),
        );
        return;
      case "ClaimPending":
        setStatus(format(outcome.amount)(t("cashuMeltToMainMintPending")));
        return;
      case "InvalidTarget":
        setStatus(t("mintUrlInvalid"));
        return;
      case "Unavailable":
        setStatus(t("cashuMeltToMainMintUnavailable"));
        return;
      case "Busy":
        return;
      case "Failed":
        setStatus(`${t("cashuMeltToMainMintFailed")}: ${outcome.detail}`);
        return;
    }
  }, [commands, formatDisplayedAmountParts, setStatus, t]);

  return { estimateMintMove, meltToDefaultMint, moveMintFunds };
};
