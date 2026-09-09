import * as Evolu from "@evolu/common";
import type { TokenRowId, WalletToken } from "@linky/linkshu";
import { CirclePlus as TokenAddIcon } from "lucide-react";
import type { Dispatch, FC, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { WalletTokenPill } from "../components/CashuTokenPill";
import type { MintIcon } from "../utils/mint";

import type { InspectCashuTokenProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import { navigateTo } from "../hooks/useRouting";

const CashuTokenIdType = Evolu.id("CashuToken");

interface CashuTokensPageProps {
  inspectCashuTokenProofStates: InspectCashuTokenProofStates | null;
  canRestoreTokens: boolean;
  cashuTotalBalance: number;
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  cashuOwnTokens: readonly WalletToken[];
  cashuOwnSpentTokensCount: number;
  cashuIssuedTokens: readonly WalletToken[];
  checkAllCashuTokensAndDeleteInvalid: () => Promise<void>;
  checkIssuedCashuTokensAndDeleteClaimed: () => Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
  deleteSpentCashuTokens: () => Promise<void>;
  deleteSpentCashuTokensIsBusy: boolean;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  restoreMissingTokens: () => Promise<void>;
  setMintIconUrlByMint: Dispatch<SetStateAction<Record<string, string | null>>>;
  tokensRestoreIsBusy: boolean;
}

export const CashuTokensPage: FC<CashuTokensPageProps> = ({
  canRestoreTokens,
  inspectCashuTokenProofStates,
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  cashuIssuedTokens,
  cashuMeltToMainMintButtonLabel,
  cashuOwnTokens,
  cashuOwnSpentTokensCount,
  checkAllCashuTokensAndDeleteInvalid,
  checkIssuedCashuTokensAndDeleteClaimed,
  deleteSpentCashuTokens,
  deleteSpentCashuTokensIsBusy,
  getMintIconUrl,
  meltLargestForeignMintToMainMint,
  restoreMissingTokens,
  setMintIconUrlByMint,
  tokensRestoreIsBusy,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();

  const tokens = useMemo(
    () => [...cashuOwnTokens, ...cashuIssuedTokens],
    [cashuOwnTokens, cashuIssuedTokens],
  );
  const {
    reports,
    loading: checkingProofs,
    refresh,
  } = useTokenProofStates(tokens, inspectCashuTokenProofStates);
  const byId = new Map(reports.map((report) => [report.rowId, report]));
  const portions = (
    entries: readonly WalletToken[],
    state: "unspent" | "pending" | "unknown",
  ) =>
    entries.flatMap((token) => {
      const report = byId.get(token.id);
      const amount =
        report?.[state] ?? (state === "unknown" ? token.amount : 0);
      return amount > 0 ? [{ token, amount }] : [];
    });
  const own = portions(
    cashuOwnTokens.filter((token) => token.state === "accepted"),
    "unspent",
  );
  const recoverable = portions(
    cashuOwnTokens.filter((token) => token.state !== "accepted"),
    "unspent",
  );
  const issued = portions(cashuIssuedTokens, "unspent");
  const pending = portions(tokens, "pending");
  const unknown = portions(tokens, "unknown");
  const spent = cashuOwnTokens
    .filter((token) => byId.get(token.id)?.spent === Number(token.amount))
    .map((token) => ({ token, amount: token.amount }));
  const total = (entries: readonly { amount: number }[]) =>
    entries.reduce((sum, entry) => sum + entry.amount, 0);
  const amountText = (entries: readonly { amount: number }[]) =>
    checkingProofs ? "…" : formatDisplayedAmountText(total(entries));

  const checkAll = async () => {
    await checkAllCashuTokensAndDeleteInvalid();
    refresh();
  };

  const hasIssuedTokens = cashuIssuedTokens.length > 0;
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (!hasIssuedTokens) return;
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void checkIssuedCashuTokensAndDeleteClaimed();
  }, [checkIssuedCashuTokensAndDeleteClaimed, hasIssuedTokens]);

  const handleMintIconLoad = useCallback(
    (origin: string, url: string | null) => {
      setMintIconUrlByMint((prev) => ({
        ...prev,
        [origin]: url,
      }));
    },
    [setMintIconUrlByMint],
  );

  const handleOpenToken = useCallback(
    (id: TokenRowId) => {
      const decoded = CashuTokenIdType.fromUnknown(id);
      if (!decoded.ok) return;
      navigateTo({
        route: "cashuToken",
        id: decoded.value,
      });
    },
    [navigateTo],
  );

  const renderTokenList = (
    tokens: readonly { token: WalletToken; amount: number }[],
    emptyLabel: string,
    label: string,
    isSpent = false,
  ) => {
    if (tokens.length === 0) {
      return <p className="muted">{emptyLabel}</p>;
    }

    return (
      <div className="ln-tags">
        {tokens.map(({ token, amount }) => (
          <WalletTokenPill
            key={token.id}
            token={token}
            amount={amount}
            getMintIconUrl={getMintIconUrl}
            isError={isSpent || token.state === "error"}
            onMintIconLoad={handleMintIconLoad}
            onMintIconError={handleMintIconLoad}
            onOpenToken={handleOpenToken}
            ariaLabel={`${label}: ${formatDisplayedAmountText(amount)} · ${token.mint ?? ""}`}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <section className="panel">
        <p className="muted wallet-proof-status" role="status">
          {checkingProofs
            ? t("cashuCheckingProofs")
            : t("cashuProofGroupsHint")}
        </p>
        <div
          className="ln-list wallet-token-list wallet-pending-tokens"
          aria-label={t("cashuPendingAtMint")}
        >
          <div className="list-header">
            <span>
              {t("cashuPendingAtMint")} · {amountText(pending)}
            </span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={refresh}
              disabled={
                checkingProofs ||
                cashuIsBusy ||
                inspectCashuTokenProofStates === null
              }
            >
              {t("cashuRefreshProofs")}
            </button>
          </div>
          <p className="muted">{t("cashuPendingAtMintHint")}</p>
          {renderTokenList(
            pending,
            checkingProofs
              ? t("cashuCheckingProofs")
              : t("cashuNoPendingProofs"),
            t("cashuPendingAtMint"),
          )}
        </div>

        <div className="ln-list wallet-token-list">
          <div className="list-header">
            <span>
              {t("cashuAvailableProofs")} · {amountText(own)}
            </span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={() => void checkAll()}
              disabled={
                cashuIsBusy ||
                cashuBulkCheckIsBusy ||
                checkingProofs ||
                tokens.length === 0
              }
            >
              {t("cashuCheckAllTokens")}
            </button>
          </div>
          {renderTokenList(
            own,
            checkingProofs ? t("cashuCheckingProofs") : t("cashuEmpty"),
            t("cashuAvailableProofs"),
          )}
          {recoverable.length > 0 ? (
            <>
              <p className="muted">{t("cashuNeedsRecovery")}</p>
              {renderTokenList(recoverable, "", t("cashuNeedsRecovery"))}
            </>
          ) : null}
          {spent.length > 0 ? (
            <>
              <p className="muted">{t("cashuSpentProofs")}</p>
              {renderTokenList(spent, "", t("cashuSpentProofs"), true)}
            </>
          ) : null}
          {cashuOwnSpentTokensCount > 0 ? (
            <div className="settings-row section-actions">
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() => void deleteSpentCashuTokens()}
                disabled={cashuIsBusy || deleteSpentCashuTokensIsBusy}
              >
                {t("cashuDeleteSpentTokens").replace(
                  "{count}",
                  String(cashuOwnSpentTokensCount),
                )}
              </button>
            </div>
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

        {!checkingProofs && unknown.length > 0 ? (
          <div
            className="ln-list wallet-token-list"
            aria-label={t("cashuUnknownProofs")}
          >
            <div className="list-header">
              <span>
                {t("cashuUnknownProofs")} · {amountText(unknown)}
              </span>
            </div>
            <p className="muted">{t("cashuUnknownProofsHint")}</p>
            {renderTokenList(unknown, "", t("cashuUnknownProofs"))}
          </div>
        ) : null}

        <div className="ln-list wallet-token-list">
          <div className="list-header">
            <span>
              {t("cashuIssued")} · {amountText(issued)}
            </span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={() =>
                void checkIssuedCashuTokensAndDeleteClaimed().then(refresh)
              }
              disabled={!hasIssuedTokens}
            >
              {t("cashuCheckIssuedTokens")}
            </button>
          </div>
          {renderTokenList(
            issued,
            checkingProofs ? t("cashuCheckingProofs") : t("cashuIssuedEmpty"),
            t("cashuIssued"),
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
