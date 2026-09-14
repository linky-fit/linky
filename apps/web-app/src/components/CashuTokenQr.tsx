import { useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useTokenQr } from "../app/hooks/cashu/useTokenQr";

interface CashuTokenQrProps {
  tokenText: string;
  copyText: (text: string) => Promise<void>;
}

export const CashuTokenQr = ({ tokenText, copyText }: CashuTokenQrProps) => {
  const { t } = useAppShellCore();
  const [visible, setVisible] = useState(false);
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const {
    frameCount: tokenQrFrameCount,
    src: tokenQr,
    canToggleAnimation,
    isTooLargeForStatic,
  } = useTokenQr(visible ? tokenText : "", animationEnabled);

  if (!visible) {
    return (
      <div className="settings-row">
        <button
          className="btn-wide secondary"
          onClick={() => setVisible(true)}
          disabled={!tokenText.trim()}
        >
          {t("cashuShowTokenQr")}
        </button>
      </div>
    );
  }

  return (
    <>
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
          {tokenQrFrameCount === null ? null : (
            <p className="muted cashu-token-qr-hint">
              {t("cashuTokenAnimatedQrHint").replace(
                "{frames}",
                String(tokenQrFrameCount),
              )}
            </p>
          )}
        </div>
      ) : null}

      {canToggleAnimation ? (
        <>
          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">{t("cashuTokenAnimateQr")}</span>
            </div>
            <div className="settings-right">
              <label className="switch">
                <input
                  className="switch-input"
                  type="checkbox"
                  checked={animationEnabled}
                  aria-label={t("cashuTokenAnimateQr")}
                  onChange={(event) =>
                    setAnimationEnabled(event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          {!animationEnabled && isTooLargeForStatic ? (
            <p className="muted">{t("cashuTokenStaticQrUnavailable")}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
};
