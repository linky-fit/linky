import { Copy } from "lucide-react";
import React, { type FC } from "react";
import { WalletBalance } from "../components/WalletBalance";
import type { Translate } from "../i18n";
import { optimizeCaseInsensitiveQrPayload } from "../utils/qrPayload";

type TopupInvoiceQrMode = "cashu" | "universal" | "lightning";

interface TopupInvoicePageProps {
  copyText: (text: string) => Promise<void>;
  t: Translate;
  topupAmount: string;
  topupInvoice: string | null;
  topupInvoiceCashuRequest: string | null;
  topupInvoiceError: string | null;
  topupInvoiceIsBusy: boolean;
  topupMintUrl: string | null;
  topupInvoiceQr: string | null;
  topupInvoiceQrPayload: string | null;
}

interface TopupInvoiceQrModeSwitchProps {
  cashuDisabled: boolean;
  lightningDisabled: boolean;
  mode: TopupInvoiceQrMode;
  onChange: (mode: TopupInvoiceQrMode) => void;
  t: Translate;
}

const TopupInvoiceQrModeSwitch: FC<TopupInvoiceQrModeSwitchProps> = ({
  cashuDisabled,
  lightningDisabled,
  mode,
  onChange,
  t,
}) => {
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const cashuTabRef = React.useRef<HTMLButtonElement | null>(null);
  const universalTabRef = React.useRef<HTMLButtonElement | null>(null);
  const lightningTabRef = React.useRef<HTMLButtonElement | null>(null);
  const [tabMetrics, setTabMetrics] = React.useState({
    cashuLeft: 0,
    cashuWidth: 0,
    universalLeft: 0,
    universalWidth: 0,
    lightningLeft: 0,
    lightningWidth: 0,
    ready: false,
  });

  const measureTabs = React.useCallback(() => {
    const container = tabsRef.current;
    const cashu = cashuTabRef.current;
    const universal = universalTabRef.current;
    const lightning = lightningTabRef.current;
    if (!container || !cashu || !universal || !lightning) return;

    const containerRect = container.getBoundingClientRect();
    const cashuRect = cashu.getBoundingClientRect();
    const universalRect = universal.getBoundingClientRect();
    const lightningRect = lightning.getBoundingClientRect();

    setTabMetrics({
      cashuLeft: cashuRect.left - containerRect.left,
      cashuWidth: cashuRect.width,
      universalLeft: universalRect.left - containerRect.left,
      universalWidth: universalRect.width,
      lightningLeft: lightningRect.left - containerRect.left,
      lightningWidth: lightningRect.width,
      ready: true,
    });
  }, []);

  React.useLayoutEffect(() => {
    measureTabs();
  }, [measureTabs, t]);

  React.useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const container = tabsRef.current;
    const cashu = cashuTabRef.current;
    const universal = universalTabRef.current;
    const lightning = lightningTabRef.current;
    if (!container || !cashu || !universal || !lightning) return;

    const observer = new ResizeObserver(() => {
      measureTabs();
    });
    observer.observe(container);
    observer.observe(cashu);
    observer.observe(universal);
    observer.observe(lightning);
    return () => observer.disconnect();
  }, [measureTabs]);

  const indicatorLeft =
    mode === "cashu"
      ? tabMetrics.cashuLeft
      : mode === "lightning"
        ? tabMetrics.lightningLeft
        : tabMetrics.universalLeft;
  const indicatorWidth =
    mode === "cashu"
      ? tabMetrics.cashuWidth
      : mode === "lightning"
        ? tabMetrics.lightningWidth
        : tabMetrics.universalWidth;

  return (
    <div
      className="bottom-tabs-bar topup-invoice-mode-bar"
      role="tablist"
      aria-label={t("topupQrModeLabel")}
    >
      <div
        className={
          tabMetrics.ready
            ? "bottom-tabs topup-invoice-mode-tabs"
            : "bottom-tabs topup-invoice-mode-tabs no-indicator"
        }
        ref={tabsRef}
      >
        <div
          className="bottom-tabs-indicator"
          aria-hidden="true"
          style={
            tabMetrics.ready
              ? {
                  transform: `translateX(${indicatorLeft}px)`,
                  width: `${indicatorWidth}px`,
                }
              : undefined
          }
        />
        <button
          type="button"
          className={mode === "cashu" ? "bottom-tab is-active" : "bottom-tab"}
          disabled={cashuDisabled}
          onClick={() => onChange("cashu")}
          ref={cashuTabRef}
          role="tab"
          aria-selected={mode === "cashu"}
        >
          <span className="bottom-tab-label">{t("topupQrModeCashu")}</span>
        </button>
        <button
          type="button"
          className={
            mode === "universal" ? "bottom-tab is-active" : "bottom-tab"
          }
          onClick={() => onChange("universal")}
          ref={universalTabRef}
          role="tab"
          aria-selected={mode === "universal"}
        >
          <span className="bottom-tab-label">{t("topupQrModeUniversal")}</span>
        </button>
        <button
          type="button"
          className={
            mode === "lightning" ? "bottom-tab is-active" : "bottom-tab"
          }
          disabled={lightningDisabled}
          onClick={() => onChange("lightning")}
          ref={lightningTabRef}
          role="tab"
          aria-selected={mode === "lightning"}
        >
          <span className="bottom-tab-label">{t("topupQrModeLightning")}</span>
        </button>
      </div>
    </div>
  );
};

export const TopupInvoicePage: FC<TopupInvoicePageProps> = ({
  copyText,
  t,
  topupAmount,
  topupInvoice,
  topupInvoiceCashuRequest,
  topupInvoiceError,
  topupInvoiceIsBusy,
  topupMintUrl,
  topupInvoiceQr,
  topupInvoiceQrPayload,
}) => {
  const [qrMode, setQrMode] = React.useState<TopupInvoiceQrMode>("universal");
  const [selectedQr, setSelectedQr] = React.useState<string | null>(
    topupInvoiceQr,
  );
  const amountSat = Number.parseInt(topupAmount.trim(), 10);
  const mintDisplay = (topupMintUrl ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const universalPayload =
    (topupInvoiceQrPayload ?? topupInvoice ?? "").trim() || null;
  const cashuPayload = (topupInvoiceCashuRequest ?? "").trim() || null;
  const lightningPayload = (topupInvoice ?? "").trim() || null;
  const selectedPayload =
    qrMode === "cashu"
      ? cashuPayload
      : qrMode === "lightning"
        ? lightningPayload
        : universalPayload;

  React.useEffect(() => {
    setQrMode("universal");
  }, [topupInvoice, topupInvoiceCashuRequest, topupInvoiceQrPayload]);

  React.useEffect(() => {
    if (!selectedPayload) {
      setSelectedQr(null);
      return;
    }

    if (
      qrMode === "universal" &&
      selectedPayload === universalPayload &&
      topupInvoiceQr
    ) {
      setSelectedQr(topupInvoiceQr);
      return;
    }

    let cancelled = false;
    setSelectedQr(null);

    void (async () => {
      const QRCode = await import("qrcode");
      const qrPayload =
        selectedPayload === lightningPayload
          ? optimizeCaseInsensitiveQrPayload(selectedPayload)
          : selectedPayload;
      const qr = await QRCode.toDataURL(qrPayload, {
        margin: 1,
        width: 320,
      });
      if (!cancelled) setSelectedQr(qr);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    lightningPayload,
    qrMode,
    selectedPayload,
    topupInvoiceQr,
    universalPayload,
  ]);

  const handleCopyInvoice = () => {
    const copyValue = (selectedPayload ?? "").trim();
    if (!copyValue) return;
    void copyText(copyValue);
  };

  const copyButton = (
    <button
      type="button"
      className="btn-wide secondary topup-invoice-copy"
      onClick={handleCopyInvoice}
    >
      <span className="btn-label-with-icon">
        <span className="btn-label-icon" aria-hidden="true">
          <Copy size={16} />
        </span>
        <span>{t("copy")}</span>
      </span>
    </button>
  );

  const loadingMessage = (
    <p className="muted topup-invoice-loading">{t("topupFetchingInvoice")}</p>
  );

  return (
    <section className="panel topup-invoice-panel">
      <div className="topup-invoice-head">
        <div className="topup-invoice-balance">
          <WalletBalance
            ariaLabel={t("topupInvoiceTitle")}
            balance={
              Number.isFinite(amountSat) && amountSat > 0 ? amountSat : 0
            }
          />
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

      {topupInvoiceIsBusy ? (
        loadingMessage
      ) : topupInvoiceQr ? (
        <div className="topup-invoice-qr-shell">
          <TopupInvoiceQrModeSwitch
            cashuDisabled={!cashuPayload}
            lightningDisabled={!lightningPayload}
            mode={qrMode}
            onChange={setQrMode}
            t={t}
          />
          <button
            type="button"
            className="topup-invoice-qr-button"
            onClick={handleCopyInvoice}
            title={t("copy")}
          >
            {selectedQr ? (
              <img className="qr topup-invoice-qr" src={selectedQr} alt="" />
            ) : (
              <span className="muted topup-invoice-loading">
                {t("topupFetchingInvoice")}
              </span>
            )}
          </button>

          {copyButton}
        </div>
      ) : topupInvoiceError ? (
        <p className="muted">{topupInvoiceError}</p>
      ) : topupInvoice ? (
        <div className="topup-invoice-qr-shell">
          <div className="mono-box mono-box-layout">{topupInvoice}</div>
          {copyButton}
        </div>
      ) : (
        loadingMessage
      )}
    </section>
  );
};
