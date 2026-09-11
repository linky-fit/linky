import { useLatest } from "../hooks/useLatest";
import type { StoredProof, TokenTransfer } from "@linky/linkshu";
import { Radio as NfcIcon } from "lucide-react";
import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { formatStoredCashuError } from "../app/lib/cashuStoredError";
import { canReturnTransfer } from "../app/lib/cashuTransfers";

import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import { WalletBalance } from "../components/WalletBalance";
import { CashuTokenProofStatus } from "../components/CashuTokenProofStatus";
import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import type { CashuOperationId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { buildCashuShareUrl } from "../utils/deepLinks";

interface CashuTokenPageProps {
  inspectCashuProofStates: InspectCashuProofStates | null;
  canSendToContact: boolean;
  canWriteToNfc: boolean;
  cashuIsBusy: boolean;
  cashuProofs: readonly StoredProof[];
  cashuTransfers: readonly TokenTransfer[];
  checkAndRefreshCashuToken: (
    id: CashuOperationId,
  ) => Promise<"ok" | "invalid" | "transient" | "skipped">;
  checkSingleIssuedCashuTokenIsClaimed: (
    id: CashuOperationId,
  ) => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  pendingCashuDeleteId: CashuOperationId | null;
  requestDeleteCashuToken: (id: CashuOperationId) => void;
  returnCashuTokenToWallet: (id: CashuOperationId) => Promise<void>;
  routeId: CashuOperationId;
  shareTokenText: (id: CashuOperationId, text: string) => Promise<void>;
  showPaidOverlay: (title?: string) => void;
  startSendCashuTokenToContact: (id: CashuOperationId) => Promise<void>;
  writeToNfc: (id: CashuOperationId, tokenText: string) => Promise<void>;
}

/** What the status line says for a transfer that is not in an error. */
const statusKeyOf = (transfer: TokenTransfer): I18nKey | null => {
  if (transfer.kind === "send") {
    switch (transfer.status) {
      case "issued":
        return "cashuTransferIssued";
      case "pending":
        return "cashuPendingHint";
      case "externalized":
        return "cashuOnNfc";
      case "returned":
        return "cashuTransferReturned";
      case "done":
        return "cashuTransferClaimed";
      default:
        return null;
    }
  }
  switch (transfer.status) {
    case "pending":
      return "cashuReceivePending";
    case "done":
      return "cashuTransferReceived";
    default:
      return null;
  }
};

export const CashuTokenPage: FC<CashuTokenPageProps> = ({
  inspectCashuProofStates,
  canSendToContact,
  canWriteToNfc,
  cashuIsBusy,
  cashuProofs,
  cashuTransfers,
  checkAndRefreshCashuToken,
  checkSingleIssuedCashuTokenIsClaimed,
  copyText,
  pendingCashuDeleteId,
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
  const transfer = cashuTransfers.find(
    (candidate) => String(candidate.id) === routeId,
  );
  const tokenText = transfer?.tokenText ?? "";
  const tokenAmount = transfer?.amount ?? 0;
  const mintDisplay = getMintDisplay(transfer?.mint);
  const transferProofs = React.useMemo(
    () =>
      cashuProofs.filter(
        (proof) =>
          proof.operationId !== null && String(proof.operationId) === routeId,
      ),
    [cashuProofs, routeId],
  );

  const isSend = transfer?.kind === "send";
  const isIssued = isSend && transfer.status === "issued";
  const isOpenSend =
    transfer !== undefined && isSend && canReturnTransfer(transfer);
  const isFailedReceive =
    transfer?.kind === "receive" && transfer.status === "failed";
  const canReturnToWallet =
    transfer !== undefined && canReturnTransfer(transfer);
  const statusKey = transfer === undefined ? null : statusKeyOf(transfer);
  const shareUrl = buildCashuShareUrl(tokenText);
  const shareMessage = (() => {
    if (!shareUrl) return "";
    if (tokenAmount > 0) {
      return t("cashuShareMessageWithAmount")
        .replace("{amount}", formatDisplayedAmountText(tokenAmount))
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
  // token (issue #86): checkProofsStates is the passive NUT-07 query, so it
  // doesn't consume the proofs. Once all proofs flip to SPENT the transfer
  // closes as claimed and we navigate back to the tokens list.
  //
  // The helper's identity changes whenever the read model updates, so the
  // latest reference is stashed in a ref to keep the 10s interval from being
  // torn down + restarted on every churn.
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

  // The transfer list hydrates asynchronously from Evolu and is briefly empty
  // on first mount, so a missing transfer only shows the recovery panel after
  // a delay, and a transfer that vanished after loading once bounces back.
  const transferMissing = transfer === undefined;
  const loadedRouteIdRef = React.useRef<CashuOperationId | null>(null);
  const [showMissingRecovery, setShowMissingRecovery] = React.useState(false);
  if (!transferMissing) loadedRouteIdRef.current = routeId;
  React.useEffect(() => {
    setShowMissingRecovery(false);
    if (!transferMissing || loadedRouteIdRef.current === routeId) return;

    const timeoutId = window.setTimeout(() => {
      setShowMissingRecovery(true);
    }, 750);
    return () => window.clearTimeout(timeoutId);
  }, [routeId, transferMissing]);

  React.useEffect(() => {
    if (!transferMissing) return;
    if (loadedRouteIdRef.current !== routeId) return;
    navigateTo({ route: "cashuTokens" });
  }, [routeId, transferMissing]);

  if (transfer === undefined) {
    if (!showMissingRecovery) return null;

    return (
      <section className="panel topup-invoice-panel cashu-token-panel">
        <p className="cashu-token-status cashu-token-status-error">
          {t("cashuInvalid")}
        </p>
      </section>
    );
  }

  const isClosed = transfer.status === "done" || transfer.status === "returned";

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

      {isFailedReceive ? (
        <p className="cashu-token-status cashu-token-status-error">
          {formatStoredCashuError(transfer.error) ?? t("cashuReceiveFailed")}
        </p>
      ) : statusKey !== null ? (
        <p className="cashu-token-status">{t(statusKey)}</p>
      ) : null}
      {!isFailedReceive && transfer.error !== null ? (
        <p className="cashu-token-status cashu-token-status-error">
          {formatStoredCashuError(transfer.error)}
        </p>
      ) : null}

      {isSend && transferProofs.length > 0 ? (
        <CashuTokenProofStatus
          proofs={transferProofs}
          inspect={inspectCashuProofStates}
          busy={cashuIsBusy}
        />
      ) : null}

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

      {isOpenSend || isFailedReceive ? (
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

      {isOpenSend ? (
        <div className="settings-row">
          <button
            className="btn-wide secondary"
            onClick={() => void shareTokenText(routeId, shareMessage)}
            disabled={!shareMessage}
          >
            {t("share")}
          </button>
        </div>
      ) : null}

      {isOpenSend && canWriteToNfc ? (
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

      {!isClosed ? (
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
      ) : null}
    </section>
  );
};
