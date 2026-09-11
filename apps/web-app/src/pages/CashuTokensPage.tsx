import * as Evolu from "@evolu/common";
import type {
  OperationId,
  ProofState,
  ProofStateSnapshot,
  StoredProof,
  TokenTransfer,
} from "@linky/linkshu";
import { CirclePlus as TokenAddIcon } from "lucide-react";
import type { Dispatch, FC, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { TransferPill } from "../components/CashuTokenPill";
import type { MintIcon } from "../utils/mint";

import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";

const CashuOperationIdType = Evolu.id("CashuOperation");

interface CashuTokensPageProps {
  inspectCashuProofStates: InspectCashuProofStates | null;
  canRestoreTokens: boolean;
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  /** The whole inventory, every state. */
  cashuProofs: readonly StoredProof[];
  /** Transfers still open: issued, pending, externalized sends; pending or failed receives. */
  cashuOpenTransfers: readonly TokenTransfer[];
  checkAllCashuTokensAndDeleteInvalid: () => Promise<void>;
  checkIssuedCashuTokensAndDeleteClaimed: () => Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  restoreMissingTokens: () => Promise<void>;
  setMintIconUrlByMint: Dispatch<SetStateAction<Record<string, string | null>>>;
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

/**
 * First-draft inventory view: one table per proof state with the mint's
 * live answer per proof, plus the open transfers as pills. The mint answer
 * is a snapshot kept in memory; the stored state is what the wallet acts on.
 */
export const CashuTokensPage: FC<CashuTokensPageProps> = ({
  canRestoreTokens,
  inspectCashuProofStates,
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  cashuMeltToMainMintButtonLabel,
  cashuOpenTransfers,
  cashuProofs,
  checkAllCashuTokensAndDeleteInvalid,
  checkIssuedCashuTokensAndDeleteClaimed,
  getMintIconUrl,
  meltLargestForeignMintToMainMint,
  restoreMissingTokens,
  setMintIconUrlByMint,
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

  const handleMintIconLoad = useCallback(
    (origin: string, url: string | null) => {
      setMintIconUrlByMint((prev) => ({
        ...prev,
        [origin]: url,
      }));
    },
    [setMintIconUrlByMint],
  );

  const handleOpenTransfer = useCallback((id: OperationId) => {
    const decoded = CashuOperationIdType.fromUnknown(id);
    if (!decoded.ok) return;
    navigateTo({ route: "cashuToken", id: decoded.value });
  }, []);

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
          </div>
        ) : null}

        <div
          className="ln-list wallet-token-list"
          aria-label={t("cashuTransfers")}
        >
          <div className="list-header">
            <span>{t("cashuTransfers")}</span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={() =>
                void checkIssuedCashuTokensAndDeleteClaimed().then(refresh)
              }
              disabled={!hasHandedOut}
            >
              {t("cashuCheckIssuedTokens")}
            </button>
          </div>
          {cashuOpenTransfers.length === 0 ? (
            <p className="muted">{t("cashuTransfersEmpty")}</p>
          ) : (
            <div className="ln-tags">
              {cashuOpenTransfers.map((transfer) => (
                <TransferPill
                  key={transfer.id}
                  transfer={transfer}
                  getMintIconUrl={getMintIconUrl}
                  onMintIconLoad={handleMintIconLoad}
                  onMintIconError={handleMintIconLoad}
                  onOpenTransfer={handleOpenTransfer}
                  ariaLabel={`${t("cashuTransfers")}: ${formatDisplayedAmountText(transfer.amount)} · ${transfer.mint}`}
                />
              ))}
            </div>
          )}
          <div className="settings-row section-actions">
            <button
              type="button"
              className="btn-wide"
              onClick={() => navigateTo({ route: "cashuTokenEmit" })}
              disabled={cashuIsBusy}
            >
              {t("cashuEmit")}
            </button>
          </div>
        </div>
      </section>

      <button
        type="button"
        className="contacts-fab"
        onClick={() => navigateTo({ route: "cashuTokenNew" })}
        aria-label={t("cashuAddToken")}
        title={t("cashuAddToken")}
      >
        <TokenAddIcon className="contacts-fab-svgIcon" />
      </button>
    </>
  );
};
