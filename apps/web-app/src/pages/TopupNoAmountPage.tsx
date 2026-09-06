import React from "react";
import { Copy } from "lucide-react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";

export function TopupNoAmountPage(): React.ReactElement {
  const { copyText } = useAppShellActions();
  const { effectiveMyLightningAddress, t } = useAppShellCore();
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const target = (effectiveMyLightningAddress ?? "").trim();

    if (!target) {
      setQrDataUrl(null);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const QRCode = await import("qrcode");
        const nextQrDataUrl = await QRCode.toDataURL(target, {
          errorCorrectionLevel: "M",
          margin: 1,
          scale: 8,
          width: 512,
        });

        if (!cancelled) {
          setQrDataUrl(nextQrDataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveMyLightningAddress]);

  const target = (effectiveMyLightningAddress ?? "").trim();

  return (
    <section className="panel topup-invoice-panel topup-no-amount-panel">
      <div className="topup-invoice-head">
        <div className="topup-invoice-balance">
          <h3>{t("topupNoAmountTitle")}</h3>
        </div>
      </div>

      {target && qrDataUrl ? (
        <div className="topup-invoice-qr-shell">
          <button
            type="button"
            className="topup-invoice-qr-button"
            onClick={() => void copyText(target)}
            title={t("copy")}
          >
            <img className="qr topup-invoice-qr" src={qrDataUrl} alt="" />
          </button>

          <div className="mono-box topup-no-amount-address">{target}</div>

          <button
            type="button"
            className="btn-wide secondary topup-invoice-copy"
            onClick={() => void copyText(target)}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                <Copy size={16} />
              </span>
              <span>{t("copy")}</span>
            </span>
          </button>
        </div>
      ) : (
        <p className="muted topup-invoice-loading">
          {t("topupNoAmountMissingAddress")}
        </p>
      )}
    </section>
  );
}
