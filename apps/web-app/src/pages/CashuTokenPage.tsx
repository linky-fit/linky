import { useLatest } from "../hooks/useLatest";
import { parseTokenText } from "@linky/linkshu";
import { Radio as NfcIcon } from "lucide-react";
import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { formatStoredCashuError } from "../app/lib/cashuStoredError";
import {
  isCashuTokenAcceptedState,
  isCashuTokenErrorState,
  isCashuTokenExternalizedState,
  isCashuTokenIssuedState,
  isCashuTokenReservedState,
  isCashuTokenUnavailableState,
} from "../app/lib/cashuTokenState";
import { extractCashuTokenMeta } from "../app/lib/tokenText";

import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import { WalletBalance } from "../components/WalletBalance";
import type { CashuTokenId, CashuTokenRow } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import { buildCashuShareUrl } from "../utils/deepLinks";

interface CashuTokenPageProps {
  canSendToContact: boolean;
  canWriteToNfc: boolean;
  cashuIsBusy: boolean;
  cashuTokensAll: readonly CashuTokenRow[];
  checkAndRefreshCashuToken: (
    id: CashuTokenId,
  ) => Promise<"ok" | "invalid" | "transient" | "skipped">;
  checkSingleIssuedCashuTokenIsClaimed: (id: CashuTokenId) => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  pendingCashuDeleteId: CashuTokenId | null;
  reserveCashuToken: (id: CashuTokenId) => Promise<void>;
  requestDeleteCashuToken: (id: CashuTokenId) => void;
  returnCashuTokenToWallet: (id: CashuTokenId) => Promise<void>;
  routeId: CashuTokenId;
  shareTokenText: (id: CashuTokenId, text: string) => Promise<void>;
  showPaidOverlay: (title?: string) => void;
  startSendCashuTokenToContact: (id: CashuTokenId) => Promise<void>;
  writeToNfc: (id: CashuTokenId, tokenText: string) => Promise<void>;
}

export const CashuTokenPage: FC<CashuTokenPageProps> = ({
  canSendToContact,
  canWriteToNfc,
  cashuIsBusy,
  cashuTokensAll,
  checkAndRefreshCashuToken,
  checkSingleIssuedCashuTokenIsClaimed,
  copyText,
  pendingCashuDeleteId,
  reserveCashuToken,
  requestDeleteCashuToken,
  returnCashuTokenToWallet,
  routeId,
  shareTokenText,
  showPaidOverlay,
  startSendCashuTokenToContact,
  writeToNfc,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();

  const [tokenQr, setTokenQr] = React.useState<string | null>(null);
  const row = cashuTokensAll.find(
    (tkn) => tkn.id === routeId && !tkn.isDeleted,
  );

  const tokenMeta = row ? extractCashuTokenMeta(row) : null;
  const tokenText = tokenMeta?.tokenText ?? "";

  const { mintText, tokenAmount } = React.useMemo(() => {
    const parsed = tokenText ? parseTokenText(tokenText) : null;
    const storedAmount = tokenMeta?.amount ?? 0;
    const amount =
      Number.isFinite(storedAmount) && storedAmount > 0
        ? storedAmount
        : (parsed?.amount ?? 0);
    const mint = (tokenMeta?.mint ?? "").trim() || (parsed?.mint ?? "");
    return { mintText: mint, tokenAmount: amount };
  }, [tokenMeta?.amount, tokenMeta?.mint, tokenText]);
  const mintDisplay = getMintDisplay(mintText);
  const isExternalized = isCashuTokenExternalizedState(row?.state);
  const isIssued = isCashuTokenIssuedState(row?.state);
  const isReserved = isCashuTokenReservedState(row?.state);
  const isPending = (row?.state ?? "") === "pending";
  const isOwnToken = isCashuTokenAcceptedState(row?.state);
  // Error rows can hold live proofs (e.g. a partially spent receive); linkshu
  // `returnToWallet` re-receives them, which is the recovery path since
  // validation itself never resurrects an error row.
  const canReturnToWallet =
    isCashuTokenUnavailableState(row?.state) ||
    isCashuTokenErrorState(row?.state);
  const shareUrl = buildCashuShareUrl(tokenText);
  const shareMessage = (() => {
    if (!shareUrl) return "";

    if (tokenMeta?.amount && tokenMeta.amount > 0) {
      return t("cashuShareMessageWithAmount")
        .replace("{amount}", formatDisplayedAmountText(tokenMeta.amount))
        .replace("{url}", shareUrl);
    }

    return t("cashuShareMessage").replace("{url}", shareUrl);
  })();

  React.useEffect(() => {
    let cancelled = false;

    const generate = async () => {
      if (!tokenText.trim()) {
        setTokenQr(null);
        return;
      }

      try {
        const QRCode = await import("qrcode");
        let qr: string;
        try {
          qr = await QRCode.toDataURL(tokenText, {
            errorCorrectionLevel: "M",
            margin: 2,
          });
        } catch {
          // Large multi-proof Cashu tokens can exceed QR capacity at M while
          // still fitting at L. Copy/share remain available if even L cannot
          // represent the token.
          qr = await QRCode.toDataURL(tokenText, {
            errorCorrectionLevel: "L",
            margin: 2,
          });
        }
        if (!cancelled) {
          setTokenQr(qr);
        }
      } catch {
        if (!cancelled) {
          setTokenQr(null);
        }
      }
    };

    void generate();

    return () => {
      cancelled = true;
    };
  }, [tokenText]);

  // Poll the source mint while the user is staring at the QR of an issued
  // token (issue #86): wallet.checkProofsStates is the passive NUT-07
  // query, so it doesn't consume the proofs. Once all proofs flip to
  // SPENT the helper soft-deletes the row and we navigate back to the
  // tokens list — staying on the now-orphan detail page would just
  // render the generic error panel.
  //
  // The helper's identity changes whenever cashuTokensAll updates, so
  // we stash the latest reference in a ref to keep the 10s interval
  // from being torn down + restarted on every churn. Without this the
  // tick was effectively firing every couple of seconds under load.
  const checkSingleIssuedRef = useLatest(checkSingleIssuedCashuTokenIsClaimed);

  React.useEffect(() => {
    if (!isIssued) return;

    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const claimed = await checkSingleIssuedRef.current(routeId);
        if (claimed && !cancelled) {
          showPaidOverlay(t("cashuTokenClaimed"));
          navigateTo({ route: "cashuTokens" });
        }
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isIssued, routeId, showPaidOverlay, t, checkSingleIssuedRef]);

  // If the row vanished after we had loaded it once (claim detector,
  // manual delete, etc.), bounce back to the tokens list instead of
  // rendering the generic error panel. Critical: do NOT navigate when
  // the row is undefined on the FIRST render — cashuTokensAll is
  // hydrated asynchronously from Evolu and is briefly empty on initial
  // mount, which would otherwise kick the user out before the QR has
  // a chance to render.
  const rowMissing = !row || !tokenMeta;
  const loadedRouteIdRef = React.useRef<CashuTokenId | null>(null);
  const [showMissingRecovery, setShowMissingRecovery] = React.useState(false);
  if (!rowMissing) loadedRouteIdRef.current = routeId;
  React.useEffect(() => {
    setShowMissingRecovery(false);
    if (!rowMissing || loadedRouteIdRef.current === routeId) return;

    const timeoutId = window.setTimeout(() => {
      setShowMissingRecovery(true);
    }, 750);
    return () => window.clearTimeout(timeoutId);
  }, [routeId, rowMissing]);

  React.useEffect(() => {
    if (!rowMissing) return;
    if (loadedRouteIdRef.current !== routeId) return;
    navigateTo({ route: "cashuTokens" });
  }, [routeId, rowMissing]);

  if (rowMissing) {
    if (!showMissingRecovery) return null;

    return (
      <section className="panel topup-invoice-panel cashu-token-panel">
        <p className="cashu-token-status cashu-token-status-error">
          {t("cashuInvalid")}
        </p>
        <div className="settings-row">
          <button
            className={
              pendingCashuDeleteId === routeId
                ? "btn-wide secondary danger-armed"
                : "btn-wide secondary"
            }
            onClick={() => requestDeleteCashuToken(routeId)}
          >
            {t("delete")}
          </button>
        </div>
      </section>
    );
  }

  const safeRow = row;

  return (
    <section className="panel topup-invoice-panel cashu-token-panel">
      <div className="topup-invoice-head">
        <div className="topup-invoice-balance">
          <WalletBalance ariaLabel={t("cashuToken")} balance={tokenAmount} />
        </div>

        {mintDisplay ? (
          <p className="topup-invoice-mint-note">
            Mint:{" "}
            <span className="relay-url topup-invoice-mint-value">
              {mintDisplay}
            </span>
          </p>
        ) : null}
      </div>

      {(safeRow.state ?? "") === "error" && (
        <p className="cashu-token-status cashu-token-status-error">
          {formatStoredCashuError(safeRow.error) ?? t("cashuInvalid")}
        </p>
      )}

      {isExternalized && (
        <p className="cashu-token-status">{t("cashuOnNfc")}</p>
      )}

      {isPending && (
        <p className="cashu-token-status">{t("cashuPendingHint")}</p>
      )}

      {tokenQr ? (
        <div className="topup-invoice-qr-shell cashu-token-qr-shell">
          <button
            type="button"
            className="topup-invoice-qr-button cashu-token-qr-button"
            onClick={() => void copyText(tokenText)}
            title={t("copy")}
            aria-label={t("copy")}
          >
            <img
              className="qr topup-invoice-qr cashu-token-qr"
              src={tokenQr}
              alt={t("cashuToken")}
            />
          </button>
        </div>
      ) : null}

      {!isIssued && !isPending && !isReserved ? (
        <div className="settings-row">
          <button
            className="btn-wide"
            onClick={() => void checkAndRefreshCashuToken(routeId)}
            disabled={cashuIsBusy}
          >
            {t("cashuCheckToken")}
          </button>
        </div>
      ) : null}

      {isIssued && canSendToContact ? (
        <div className="settings-row">
          <button
            className="btn-wide"
            onClick={() => void startSendCashuTokenToContact(routeId)}
            disabled={!tokenText.trim()}
          >
            {t("cashuSendToContact")}
          </button>
        </div>
      ) : null}

      <div className="settings-row">
        <button
          className="btn-wide secondary"
          onClick={() => void copyText(tokenText)}
          disabled={!tokenText.trim()}
        >
          {t("copy")}
        </button>
      </div>

      <div className="settings-row">
        <button
          className="btn-wide secondary"
          onClick={() => void shareTokenText(routeId, shareMessage)}
          disabled={!shareMessage}
        >
          {t("share")}
        </button>
      </div>

      {isOwnToken ? (
        <div className="settings-row">
          <button
            className="btn-wide secondary"
            onClick={() => void reserveCashuToken(routeId)}
            disabled={cashuIsBusy}
          >
            {t("cashuMarkReserved")}
          </button>
        </div>
      ) : null}

      {canWriteToNfc ? (
        <div className="settings-row">
          <button
            className="btn-wide secondary"
            onClick={() => void writeToNfc(routeId, tokenText)}
            disabled={!tokenText.trim()}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                <NfcIcon size={18} />
              </span>
              <span>{t("uploadToNfc")}</span>
            </span>
          </button>
        </div>
      ) : null}

      {canReturnToWallet ? (
        <div className="settings-row">
          <button
            className="btn-wide secondary"
            onClick={() => void returnCashuTokenToWallet(routeId)}
            disabled={cashuIsBusy}
          >
            {t("cashuReturnToWallet")}
          </button>
        </div>
      ) : null}

      <div className="settings-row">
        <button
          className={
            pendingCashuDeleteId === routeId
              ? "btn-wide secondary danger-armed"
              : "btn-wide secondary"
          }
          onClick={() => requestDeleteCashuToken(routeId)}
        >
          {t("delete")}
        </button>
      </div>
    </section>
  );
};
