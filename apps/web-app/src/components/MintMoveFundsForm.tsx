import type { AutoswapEstimate } from "@linky/linkshu";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import { formatMintHost } from "../utils/mint";
import { AmountDisplay } from "./AmountDisplay";
import { Keypad } from "./Keypad";
import { useAmountInputKeypad } from "./useAmountInputKeypad";

interface MintMoveFundsFormProps {
  /** Sat available at the source mint. */
  available: number;
  busy: boolean;
  estimateMintMove: (move: MintMove) => Promise<AutoswapEstimate | null>;
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
  moveMintFunds,
  sourceMint,
  targets,
}: MintMoveFundsFormProps) {
  const { displayUnit, formatDisplayedAmountText, t } = useAppShellCore();
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
    return <p className="muted">{t("mintMoveNoTarget")}</p>;
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
    if (move === null) return;
    if (await moveMintFunds(move)) {
      setEditedAmount(null);
      setEstimated(null);
    }
  };

  return (
    <div className="mint-move-form">
      <label htmlFor="mintMoveTarget">{t("mintMoveTarget")}</label>
      <select
        id="mintMoveTarget"
        className="select"
        value={target}
        disabled={busy}
        onChange={(event) => setTargetMint(event.target.value)}
      >
        {targets.map((mint) => (
          <option key={mint} value={mint}>
            {formatMintHost(mint)}
          </option>
        ))}
      </select>

      <AmountDisplay
        amount={amount}
        cycleOnClick
        inputDisplayValue={amountInput.inputDisplayValue}
      />
      <p className="muted mint-move-maximum">
        {t("mintMoveMaximum").replace(
          "{amount}",
          formatDisplayedAmountText(available),
        )}
      </p>
      <Keypad
        ariaLabel={`${t("payAmount")} (${displayUnit})`}
        decimalKeyEnabled={amountInput.decimalKeyEnabled}
        disabled={busy}
        onKeyPress={amountInput.onKeyPress}
        translations={{
          clearForm: t("clearForm"),
          decimalPoint: t("decimalPoint"),
          delete: t("delete"),
        }}
      />

      {rows !== null ? (
        <>
          <dl className="mint-move-estimate" aria-label={t("mintMoveEstimate")}>
            <dt className="muted">{t("mintMoveArrives")}</dt>
            <dd>{formatDisplayedAmountText(rows.arrives)}</dd>
            <dt className="muted">{t("mintMoveFeeLightning")}</dt>
            <dd>{formatDisplayedAmountText(rows.lightningFeeReserve)}</dd>
            <dt className="muted">{t("mintMoveFeeInput")}</dt>
            <dd>{formatDisplayedAmountText(rows.inputFee)}</dd>
            <dt className="muted">{t("mintMoveTotal")}</dt>
            <dd>{formatDisplayedAmountText(rows.leaves)}</dd>
          </dl>
          <p className="muted">
            {exceedsBalance
              ? t("mintMoveExceedsBalance")
              : isSweep
                ? t("mintMoveSweepNote")
                : t("mintMoveEstimateNote")}
          </p>
          <button
            type="button"
            className="btn-wide"
            disabled={busy || exceedsBalance}
            onClick={() => void runMove()}
          >
            {t("mintMoveConfirm")}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-wide secondary"
          disabled={busy || estimating || move === null}
          onClick={() => void runEstimate()}
        >
          {estimating ? t("mintMoveEstimating") : t("mintMoveEstimate")}
        </button>
      )}
    </div>
  );
}
