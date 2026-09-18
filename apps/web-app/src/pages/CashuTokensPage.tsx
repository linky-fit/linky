import { CashuOperationId } from "@linky/linksync";
import type {
  StoredProof,
  TokenTransfer,
  RestoreProgress,
} from "@linky/linkshu";
import { ChevronRight, CirclePlus as TokenAddIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  pendingTokenTransfers,
  tokenChatMessages,
} from "../app/lib/pendingTokenTransfers";
import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import type { LocalNostrMessage } from "../app/types/appTypes";
import {
  CashuTokenHandoff,
  type CashuTokenHandoffProps,
} from "../components/CashuTokenHandoff";
import { navigateTo } from "../hooks/useRouting";
import { nowSeconds } from "../utils/time";

interface CashuTokensPageProps {
  cashuIsBusy: boolean;
  canRestoreTokens: boolean;
  tokensRestoreIsBusy: boolean;
  tokensRestoreProgress: RestoreProgress | null;
  restoreMissingTokens: () => Promise<void>;
  cashuBulkCheckIsBusy: boolean;
  cashuProofs: readonly StoredProof[];
  cashuTransfers: readonly TokenTransfer[];
  contacts: CashuTokenHandoffProps["contacts"];
  messages: readonly LocalNostrMessage[];
  checkIssuedCashuTokensAndDeleteClaimed: () => Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
}

export const CashuTokensPage = ({
  cashuIsBusy,
  canRestoreTokens,
  tokensRestoreIsBusy,
  tokensRestoreProgress,
  restoreMissingTokens,
  cashuBulkCheckIsBusy,
  cashuProofs,
  cashuTransfers,
  contacts,
  messages,
  checkIssuedCashuTokensAndDeleteClaimed,
}: CashuTokensPageProps) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const scanProgress =
    tokensRestoreProgress?.phase === "scanning" &&
    tokensRestoreProgress.totalKeysets > 0
      ? tokensRestoreProgress
      : null;

  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowSeconds()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const transfers = useMemo(
    () => pendingTokenTransfers(cashuTransfers, cashuProofs),
    [cashuTransfers, cashuProofs],
  );
  const chatsByToken = useMemo(() => tokenChatMessages(messages), [messages]);
  const hasHandedOut = cashuProofs.some(
    (proof) => proof.state === "handedOut" || proof.state === "externalized",
  );
  const balancesByMint = useMemo(() => {
    const balances = new Map<
      StoredProof["mint"],
      { available: number; pending: number }
    >();
    for (const proof of cashuProofs) {
      if (
        proof.state !== "available" &&
        proof.state !== "handedOut" &&
        proof.state !== "externalized"
      )
        continue;
      const balance = balances.get(proof.mint) ?? { available: 0, pending: 0 };
      if (proof.state === "available") balance.available += proof.amount;
      else balance.pending += proof.amount;
      balances.set(proof.mint, balance);
    }
    return [...balances].sort(([a], [b]) => a.localeCompare(b));
  }, [cashuProofs]);
  const availableBalance = balancesByMint.reduce(
    (total, [, balance]) => total + balance.available,
    0,
  );
  const pendingBalance = balancesByMint.reduce(
    (total, [, balance]) => total + balance.pending,
    0,
  );
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (!hasHandedOut || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void checkIssuedCashuTokensAndDeleteClaimed();
  }, [hasHandedOut, checkIssuedCashuTokensAndDeleteClaimed]);

  return (
    <>
      <section className="panel cashu-transfers-page">
        {balancesByMint.length <= 1 ? (
          <dl className="cashu-token-balance-summary">
            <div>
              <dt>{t("cashuBalance")}</dt>
              <dd>{formatDisplayedAmountText(availableBalance)}</dd>
            </div>
            <div>
              <dt>{t("cashuPendingBalance")}</dt>
              <dd>{formatDisplayedAmountText(pendingBalance)}</dd>
            </div>
          </dl>
        ) : (
          <table className="cashu-token-balances">
            <thead>
              <tr>
                <th scope="col">{t("cashuProofsColumnMint")}</th>
                <th scope="col">{t("cashuBalance")}</th>
                <th scope="col">{t("cashuPendingBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {balancesByMint.map(([mint, balance]) => (
                <tr key={mint}>
                  <th scope="row">{getMintDisplay(mint)}</th>
                  <td>{formatDisplayedAmountText(balance.available)}</td>
                  <td>{formatDisplayedAmountText(balance.pending)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("cashuTotalBalance")}</th>
                <td>{formatDisplayedAmountText(availableBalance)}</td>
                <td>{formatDisplayedAmountText(pendingBalance)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <div className="cashu-transfers-toolbar">
          <button
            className="secondary"
            onClick={() => navigateTo({ route: "cashuProofs" })}
          >
            {t("cashuInspectProofs")}
          </button>
          <button
            disabled={cashuIsBusy}
            onClick={() => navigateTo({ route: "cashuTokenEmit" })}
          >
            {t("cashuEmit")}
          </button>
        </div>
        <div className="list-header">
          <span>
            {t("cashuPendingTransfers")} · {transfers.length}
          </span>
          <button
            className="btn-small secondary"
            onClick={() => void checkIssuedCashuTokensAndDeleteClaimed()}
            disabled={!hasHandedOut || cashuIsBusy || cashuBulkCheckIsBusy}
          >
            {t("cashuCheckIssuedTokens")}
          </button>
        </div>
        {transfers.length === 0 ? (
          <p className="muted cashu-transfers-empty">
            {t("cashuTransfersEmpty")}
          </p>
        ) : (
          <ul
            className="cashu-transfer-list"
            aria-label={t("cashuPendingTransfers")}
          >
            {transfers.map((transfer) => {
              const chats = (chatsByToken.get(transfer.tokenText) ?? []).filter(
                (message) => message.direction === "out",
              );
              const minutes = Math.max(
                0,
                Math.floor((now - transfer.createdAt) / 60),
              );
              const hours = Math.floor(minutes / 60);
              const days = Math.max(
                0,
                Math.floor((now - transfer.createdAt) / 86_400),
              );
              const partiallyClaimed = cashuProofs.some(
                (proof) =>
                  proof.operationId === transfer.id && proof.state === "spent",
              );
              const state = t(
                partiallyClaimed
                  ? "cashuPartiallyClaimed"
                  : transfer.status === "pending"
                    ? "cashuAwaitingDelivery"
                    : "cashuAwaitingClaim",
              );
              return (
                <li key={transfer.id} className="cashu-transfer-row">
                  <button
                    className="cashu-transfer-open"
                    aria-label={`${t("cashuToken")}: ${formatDisplayedAmountText(transfer.amount)}`}
                    onClick={() => {
                      const id = CashuOperationId.fromUnknown(transfer.id);
                      if (id.ok)
                        navigateTo({ route: "cashuToken", id: id.value });
                    }}
                  >
                    <span className="cashu-transfer-amount">
                      {formatDisplayedAmountText(transfer.amount)}
                    </span>
                    <span className="cashu-transfer-state">{state}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                  <CashuTokenHandoff
                    transfer={transfer}
                    chats={chats}
                    contacts={contacts}
                  />
                  <div className="cashu-transfer-meta">
                    <span>{getMintDisplay(transfer.mint)}</span>
                    <span>
                      {minutes < 1
                        ? t("cashuJustCreated")
                        : hours < 1
                          ? t("cashuPendingMinutes").replace(
                              "{minutes}",
                              String(minutes),
                            )
                          : days < 1
                            ? t("cashuPendingHours").replace(
                                "{hours}",
                                String(hours),
                              )
                            : days === 1
                              ? t("cashuPendingOneDay")
                              : t("cashuPendingDays").replace(
                                  "{days}",
                                  String(days),
                                )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="settings-row section-actions">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => void restoreMissingTokens()}
            disabled={
              !canRestoreTokens ||
              tokensRestoreIsBusy ||
              cashuIsBusy ||
              cashuBulkCheckIsBusy
            }
          >
            {tokensRestoreIsBusy ? t("restoring") : t("restoreTokens")}
          </button>
        </div>
        {tokensRestoreIsBusy && (
          <div>
            <div
              className={`cashu-restore-progress${scanProgress ? " is-determinate" : ""}`}
              role="progressbar"
              aria-label={t("restoring")}
              aria-valuemin={scanProgress ? 0 : undefined}
              aria-valuemax={scanProgress?.totalKeysets}
              aria-valuenow={scanProgress?.completedKeysets}
            >
              {scanProgress && (
                <span
                  style={{
                    width: `${(scanProgress.completedKeysets / scanProgress.totalKeysets) * 100}%`,
                  }}
                />
              )}
            </div>
            <p className="muted" role="status">
              {tokensRestoreProgress?.phase === "refreshing"
                ? t("cashuRestoreRefreshing")
                : tokensRestoreProgress?.phase === "scanning"
                  ? t("cashuRestoreScanProgress")
                      .replace(
                        "{completed}",
                        String(tokensRestoreProgress.completedKeysets),
                      )
                      .replace(
                        "{total}",
                        String(tokensRestoreProgress.totalKeysets),
                      )
                      .replace(
                        "{mints}",
                        String(tokensRestoreProgress.totalMints),
                      )
                  : t("cashuRestorePreparing")}
            </p>
          </div>
        )}
        <p className="muted">{t("cashuMissingRestoreHint")}</p>
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
