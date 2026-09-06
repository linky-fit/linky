import * as Evolu from "@evolu/common";
import type { TokenRowId, WalletToken } from "@linky/linkshu";
import { CirclePlus as TokenAddIcon } from "lucide-react";
import type { Dispatch, FC, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { WalletTokenPill } from "../components/CashuTokenPill";
import type { MintIcon } from "../utils/mint";

import { navigateTo } from "../hooks/useRouting";

const CashuTokenIdType = Evolu.id("CashuToken");

interface CashuTokensPageProps {
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
  cashuTotalBalance,
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

  const issuedBalance = cashuIssuedTokens.reduce(
    (sum, token) => sum + token.amount,
    0,
  );

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
    tokens: readonly WalletToken[],
    emptyLabel: string,
  ) => {
    if (tokens.length === 0) {
      return <p className="muted">{emptyLabel}</p>;
    }

    return (
      <div className="ln-tags">
        {tokens.map((token) => (
          <WalletTokenPill
            key={token.id}
            token={token}
            getMintIconUrl={getMintIconUrl}
            isError={token.state === "error"}
            onMintIconLoad={handleMintIconLoad}
            onMintIconError={handleMintIconLoad}
            onOpenToken={handleOpenToken}
            ariaLabel={t("cashuToken")}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <section className="panel">
        <div className="ln-list wallet-token-list">
          <div className="list-header">
            <span>
              {t("cashuMine")} · {formatDisplayedAmountText(cashuTotalBalance)}
            </span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={() => void checkAllCashuTokensAndDeleteInvalid()}
              disabled={
                cashuIsBusy ||
                cashuBulkCheckIsBusy ||
                cashuOwnTokens.length === 0
              }
            >
              {t("cashuCheckAllTokens")}
            </button>
          </div>
          {renderTokenList(cashuOwnTokens, t("cashuEmpty"))}
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

        <div className="ln-list wallet-token-list">
          <div className="list-header">
            <span>
              {t("cashuIssued")} · {formatDisplayedAmountText(issuedBalance)}
            </span>
            <button
              type="button"
              className="btn-small secondary"
              onClick={() => void checkIssuedCashuTokensAndDeleteClaimed()}
              disabled={!hasIssuedTokens}
            >
              {t("cashuCheckIssuedTokens")}
            </button>
          </div>
          {renderTokenList(cashuIssuedTokens, t("cashuIssuedEmpty"))}
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
