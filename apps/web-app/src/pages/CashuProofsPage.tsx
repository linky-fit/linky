import type {
  ProofState,
  ProofStateSnapshot,
  StoredProof,
} from "@linky/linkshu";
import type { FC } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";

import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import type { I18nKey } from "../i18n";

interface CashuProofsPageProps {
  inspectCashuProofStates: InspectCashuProofStates | null;
  canRestoreTokens: boolean;
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  /** The whole inventory, every state. */
  cashuProofs: readonly StoredProof[];
  checkAllCashuTokensAndDeleteInvalid: () => Promise<void>;
  checkIssuedCashuTokensAndDeleteClaimed: () => Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  restoreMissingTokens: () => Promise<void>;
  reclaimHandedOutTokens: () => Promise<void>;
  restoreAndReclaimAllTokens: () => Promise<void>;
  tokensRestoreIsBusy: boolean;
}

const MINT_STATE_KEY: Record<ProofStateSnapshot["state"], I18nKey> = {
  unspent: "cashuMintStateUnspent",
  pending: "cashuMintStatePending",
  spent: "cashuMintStateSpent",
  unknown: "cashuMintStateUnknown",
};

const sum = (proofs: readonly StoredProof[]) =>
  proofs.reduce((total, proof) => total + proof.amount, 0);

export const CashuProofsPage: FC<CashuProofsPageProps> = ({
  canRestoreTokens,
  inspectCashuProofStates,
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  cashuMeltToMainMintButtonLabel,
  cashuProofs,
  checkAllCashuTokensAndDeleteInvalid,
  checkIssuedCashuTokensAndDeleteClaimed,
  meltLargestForeignMintToMainMint,
  restoreMissingTokens,
  reclaimHandedOutTokens,
  restoreAndReclaimAllTokens,
  tokensRestoreIsBusy,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();

  const unspentProofs = useMemo(
    () => cashuProofs.filter((proof) => proof.state !== "spent"),
    [cashuProofs],
  );
  const {
    reports,
    loading: checkingProofs,
    refresh,
  } = useTokenProofStates(unspentProofs, inspectCashuProofStates);
  const mintStateById = useMemo(
    () => new Map(reports.map((report) => [report.proofId, report.state])),
    [reports],
  );

  const byState = (state: ProofState) =>
    unspentProofs
      .filter((proof) => proof.state === state)
      .sort((a, b) => b.amount - a.amount);
  const available = byState("available");
  const held = byState("held");
  const handedOut = [...byState("handedOut"), ...byState("externalized")];
  const spentCount = cashuProofs.length - unspentProofs.length;

  const checkAll = async () => {
    await checkAllCashuTokensAndDeleteInvalid();
    refresh();
  };

  // Handed-out proofs stay on record after their transfer closes (a
  // delivered messenger send) until the mint reports them spent, so the
  // claim check is offered whenever any are left, not only for issued ones.
  const hasHandedOut = handedOut.length > 0;
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (!hasHandedOut) return;
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void checkIssuedCashuTokensAndDeleteClaimed().then(refresh);
  }, [checkIssuedCashuTokensAndDeleteClaimed, hasHandedOut, refresh]);

  const renderProofTable = (proofs: readonly StoredProof[]) => {
    if (proofs.length === 0) {
      return <p className="muted">{t("cashuNoProofs")}</p>;
    }
    return (
      <table className="cashu-proof-table">
        <thead>
          <tr>
            <th scope="col">{t("cashuProofsColumnAmount")}</th>
            <th scope="col">{t("cashuProofsColumnMint")}</th>
            <th scope="col">{t("cashuProofsColumnMintState")}</th>
          </tr>
        </thead>
        <tbody>
          {proofs.map((proof) => {
            const mintState = checkingProofs
              ? null
              : (mintStateById.get(proof.id) ?? "unknown");
            return (
              <tr key={proof.id}>
                <td>{formatDisplayedAmountText(proof.amount)}</td>
                <td>{getMintDisplay(proof.mint)}</td>
                <td className={mintState === null ? "muted" : ""}>
                  {mintState === null ? "…" : t(MINT_STATE_KEY[mintState])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const sectionTotal = (proofs: readonly StoredProof[]) =>
    formatDisplayedAmountText(sum(proofs));

  return (
    <>
      <section className="panel">
        <p className="muted wallet-proof-status" role="status">
          {checkingProofs ? t("cashuCheckingProofs") : t("cashuInventoryHint")}
        </p>

        <div
          className="ln-list wallet-token-list"
          aria-label={t("cashuProofStateAvailable")}
        >
          <div className="list-header">
            <span>
              {t("cashuProofStateAvailable")} · {sectionTotal(available)}
            </span>
            <div className="list-header-actions">
              <button
                type="button"
                className="btn-small secondary"
                onClick={refresh}
                disabled={
                  checkingProofs ||
                  cashuIsBusy ||
                  inspectCashuProofStates === null
                }
              >
                {t("cashuRefreshProofs")}
              </button>
              <button
                type="button"
                className="btn-small secondary"
                onClick={() => void checkAll()}
                disabled={
                  cashuIsBusy ||
                  cashuBulkCheckIsBusy ||
                  checkingProofs ||
                  unspentProofs.length === 0
                }
              >
                {t("cashuCheckAllTokens")}
              </button>
            </div>
          </div>
          {renderProofTable(available)}
          {spentCount > 0 ? (
            <p className="muted">
              {t("cashuSpentProofsKept").replace("{count}", String(spentCount))}
            </p>
          ) : null}
          {cashuMeltToMainMintButtonLabel ? (
            <div className="settings-row section-actions">
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() => void meltLargestForeignMintToMainMint()}
                disabled={cashuIsBusy || cashuBulkCheckIsBusy}
              >
                {cashuMeltToMainMintButtonLabel}
              </button>
            </div>
          ) : null}
          <div className="settings-row section-actions">
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => void restoreMissingTokens()}
              disabled={!canRestoreTokens || tokensRestoreIsBusy || cashuIsBusy}
            >
              {tokensRestoreIsBusy ? t("restoring") : t("restoreTokens")}
            </button>
          </div>
        </div>

        {held.length > 0 ? (
          <div
            className="ln-list wallet-token-list"
            aria-label={t("cashuProofStateHeld")}
          >
            <div className="list-header">
              <span>
                {t("cashuProofStateHeld")} · {sectionTotal(held)}
              </span>
            </div>
            <p className="muted">
              {held.some((proof) => proof.operationId === null)
                ? t("cashuHeldUnknownHint")
                : t("cashuHeldProofsHint")}
            </p>
            {renderProofTable(held)}
          </div>
        ) : null}

        {handedOut.length > 0 ? (
          <div
            className="ln-list wallet-token-list"
            aria-label={t("cashuProofStateHandedOut")}
          >
            <div className="list-header">
              <span>
                {t("cashuProofStateHandedOut")} · {sectionTotal(handedOut)}
              </span>
            </div>
            {renderProofTable(handedOut)}
            <p className="muted">{t("cashuReclaimHint")}</p>
            <div className="settings-row section-actions">
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() => void reclaimHandedOutTokens().then(refresh)}
                disabled={
                  cashuIsBusy || cashuBulkCheckIsBusy || tokensRestoreIsBusy
                }
              >
                {t("cashuReclaimHandedOut")}
              </button>
            </div>
          </div>
        ) : null}

        <p className="muted">{t("cashuRestoreAndReclaimHint")}</p>
        <div className="settings-row section-actions">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => void restoreAndReclaimAllTokens().then(refresh)}
            disabled={
              !canRestoreTokens ||
              cashuIsBusy ||
              cashuBulkCheckIsBusy ||
              tokensRestoreIsBusy
            }
          >
            {t("cashuRestoreAndReclaimAll")}
          </button>
        </div>
      </section>
    </>
  );
};
