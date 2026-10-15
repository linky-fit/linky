import type { AutoswapEstimate } from "@linky-fit/linkshu";
import {
  Button,
  EmptyState,
  Notice,
  Section,
  Stack,
  Text,
  ListRow,
} from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import type { MintIcon as MintIconSource } from "../utils/mint";
import { formatMintLabel, mintKindBadge } from "../utils/mint";
import { AmountKeypad } from "./AmountKeypad";
import { MintButton } from "./MintButton";
import { useAmountInputKeypad } from "./useAmountInputKeypad";

interface MintMoveFundsFormProps {
  /** Sat available at the source mint. */
  available: number;
  busy: boolean;
  estimateMintMove: (move: MintMove) => Promise<AutoswapEstimate | null>;
  getMintIconUrl: (mint: string | null | undefined) => MintIconSource;
  moveMintFunds: (move: MintMove) => Promise<boolean>;
  sourceMint: string;
  /** Candidate target mints, the preferred one first. */
  targets: readonly string[];
}

const parseSat = (value: string): number | null => {
  const amount = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

interface MoveEstimateRows {
  readonly arrives: number;
  readonly inputFee: number;
  readonly leaves: number;
  readonly lightningFeeReserve: number;
}

/** A sweep's estimate prices its first attempt; the claim steps down until the fees fit the balance. */
const estimateRows = (
  estimate: AutoswapEstimate,
  sweptBalance: number | null,
): MoveEstimateRows => {
  const overshoot =
    sweptBalance === null
      ? 0
      : Math.max(0, estimate.totalFromSource - sweptBalance);
  return {
    arrives: estimate.amount - overshoot,
    inputFee: estimate.inputFee,
    leaves: estimate.totalFromSource - overshoot,
    lightningFeeReserve: estimate.lightningFeeReserve,
  };
};

export function MintMoveFundsForm({
  available,
  busy,
  estimateMintMove,
  getMintIconUrl,
  moveMintFunds,
  sourceMint,
  targets,
}: MintMoveFundsFormProps) {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const [targetMint, setTargetMint] = React.useState(targets[0] ?? "");
  // Sat, as every keypad-driven amount in the app; null until edited means the whole balance.
  const [editedAmount, setEditedAmount] = React.useState<string | null>(null);
  const amount = editedAmount ?? String(available);
  const amountInput = useAmountInputKeypad({
    amount,
    onAmountChange: setEditedAmount,
  });
  const [estimated, setEstimated] = React.useState<{
    readonly move: MintMove;
    readonly estimate: AutoswapEstimate;
  } | null>(null);
  const [estimating, setEstimating] = React.useState(false);

  const target = targets.includes(targetMint) ? targetMint : targets[0];
  const amountSat = parseSat(amount);
  const isSweep = amountSat === available;
  const move: MintMove | null =
    target === undefined || amountSat === null || amountSat > available
      ? null
      : isSweep
        ? { sourceMint, targetMint: target }
        : { sourceMint, targetMint: target, amountSat };
  const rows =
    estimated !== null &&
    move !== null &&
    estimated.move.targetMint === move.targetMint &&
    estimated.move.amountSat === move.amountSat
      ? estimateRows(estimated.estimate, isSweep ? available : null)
      : null;
  const exceedsBalance =
    rows !== null && (rows.leaves > available || rows.arrives <= 0);

  if (targets.length === 0) {
    return <EmptyState title={t("mintMoveNoTarget")} />;
  }

  const runEstimate = async () => {
    if (move === null) return;
    setEstimating(true);
    try {
      const result = await estimateMintMove(move);
      setEstimated(result === null ? null : { move, estimate: result });
    } finally {
      setEstimating(false);
    }
  };

  const runMove = async () => {
    if (move === null || estimated === null) return;
    const priced = { ...move, sourceMint: estimated.estimate.sourceMint };
    if (await moveMintFunds(priced)) {
      setEditedAmount(null);
      setEstimated(null);
    }
  };

  return (
    <Stack testID="mint-move-form" gap="$sm">
      <Section title={t("mintMoveTarget")}>
        <Stack role="group" aria-label={t("mintMoveTarget")} gap="$xs">
          {targets.map((mint) => (
            <MintButton
              key={mint}
              badge={mintKindBadge(mint)}
              chevron={false}
              disabled={busy}
              getMintIconUrl={getMintIconUrl}
              isSelected={mint === target}
              label={formatMintLabel(mint)}
              mint={mint}
              onPress={() => setTargetMint(mint)}
            />
          ))}
        </Stack>
      </Section>

      <Text variant="caption" color="$colorMuted" textAlign="center">
        {t("mintMoveMaximum").replace(
          "{amount}",
          formatDisplayedAmountText(available),
        )}
      </Text>
      <AmountKeypad amount={amount} input={amountInput} disabled={busy} />

      {rows !== null ? (
        <>
          <Stack aria-label={t("mintMoveEstimate")} gap="$xs">
            <ListRow
              title={t("mintMoveArrives")}
              value={formatDisplayedAmountText(rows.arrives)}
            />
            <ListRow
              title={t("mintMoveFeeLightning")}
              value={formatDisplayedAmountText(rows.lightningFeeReserve)}
            />
            <ListRow
              title={t("mintMoveFeeInput")}
              value={formatDisplayedAmountText(rows.inputFee)}
            />
            <ListRow
              title={t("mintMoveTotal")}
              value={formatDisplayedAmountText(rows.leaves)}
            />
          </Stack>
          {exceedsBalance ? (
            <Notice tone="danger" title={t("mintMoveExceedsBalance")} />
          ) : (
            <Text color="$colorMuted">
              {isSweep ? t("mintMoveSweepNote") : t("mintMoveEstimateNote")}
            </Text>
          )}
          <Button
            disabled={busy || exceedsBalance}
            onPress={() => void runMove()}
          >
            {t("mintMoveConfirm")}
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          loading={estimating}
          disabled={busy || move === null}
          onPress={() => void runEstimate()}
        >
          {t("mintMoveEstimate")}
        </Button>
      )}
    </Stack>
  );
}
