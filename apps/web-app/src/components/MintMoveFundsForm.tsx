import type { AutoswapEstimate } from "@linky/linkshu";
import React from "react";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import type { Translate } from "../i18n";
import { formatMintHost } from "../utils/mint";

interface MintMoveFundsFormProps {
  /** Sat available at the source mint. */
  available: number;
  busy: boolean;
  estimateMintMove: (move: MintMove) => Promise<AutoswapEstimate | null>;
  moveMintFunds: (move: MintMove) => Promise<boolean>;
  sourceMint: string;
  /** Candidate target mints, the preferred one first. */
  targets: readonly string[];
  t: Translate;
}

const parseSat = (value: string): number | null => {
  const amount = Number(value.trim());
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

const formatSat = (amount: number): string => `${amount} sat`;

export function MintMoveFundsForm({
  available,
  busy,
  estimateMintMove,
  moveMintFunds,
  sourceMint,
  targets,
  t,
}: MintMoveFundsFormProps) {
  const [targetMint, setTargetMint] = React.useState(targets[0] ?? "");
  const [amountText, setAmountText] = React.useState("");
  const [estimated, setEstimated] = React.useState<{
    readonly move: MintMove;
    readonly estimate: AutoswapEstimate;
  } | null>(null);
  const [estimating, setEstimating] = React.useState(false);

  const target = targets.includes(targetMint) ? targetMint : targets[0];
  const amountSat = parseSat(amountText);
  const move: MintMove | null =
    target !== undefined && amountSat !== null && amountSat <= available
      ? { sourceMint, targetMint: target, amountSat }
      : null;
  const estimate =
    estimated !== null &&
    move !== null &&
    estimated.move.targetMint === move.targetMint &&
    estimated.move.amountSat === move.amountSat
      ? estimated.estimate
      : null;
  const exceedsBalance =
    estimate !== null && estimate.totalFromSource > available;

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
      setAmountText("");
      setEstimated(null);
    }
  };

  return (
    <div className="mint-move-form">
      <label htmlFor="mintMoveTarget">{t("mintMoveTarget")}</label>
      <select
        id="mintMoveTarget"
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

      <label htmlFor="mintMoveAmount">{t("mintMoveAmount")}</label>
      <input
        id="mintMoveAmount"
        inputMode="numeric"
        value={amountText}
        disabled={busy}
        placeholder={String(available)}
        onChange={(event) => setAmountText(event.target.value)}
      />

      {estimate !== null ? (
        <>
          <dl className="mint-move-estimate" aria-label={t("mintMoveEstimate")}>
            <dt className="muted">{t("mintMoveArrives")}</dt>
            <dd>{formatSat(estimate.amount)}</dd>
            <dt className="muted">{t("mintMoveFeeLightning")}</dt>
            <dd>{formatSat(estimate.lightningFeeReserve)}</dd>
            <dt className="muted">{t("mintMoveFeeInput")}</dt>
            <dd>{formatSat(estimate.inputFee)}</dd>
            <dt className="muted">{t("mintMoveTotal")}</dt>
            <dd>{formatSat(estimate.totalFromSource)}</dd>
          </dl>
          <p className="muted">
            {exceedsBalance
              ? t("mintMoveExceedsBalance")
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
