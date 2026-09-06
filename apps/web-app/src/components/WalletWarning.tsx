import React from "react";
import { MessageCircle, ShieldCheck } from "lucide-react";
import type { Translate } from "../i18n";

interface WalletWarningProps {
  dismissed: boolean;
  onContactSupport: () => void;
  onDismiss: () => void;
  t: Translate;
}

export function WalletWarning({
  dismissed,
  onContactSupport,
  onDismiss,
  t,
}: WalletWarningProps): React.ReactElement {
  return (
    <div
      className={dismissed ? "wallet-warning is-hidden" : "wallet-warning"}
      role={dismissed ? undefined : "status"}
      aria-hidden={dismissed}
    >
      <button
        type="button"
        className="wallet-warning-close"
        onClick={onDismiss}
        aria-label={t("close")}
        title={t("close")}
      >
        ×
      </button>
      <div className="wallet-warning-icon" aria-hidden="true">
        <ShieldCheck size={16} strokeWidth={2.5} />
      </div>
      <div className="wallet-warning-text">
        <div className="wallet-warning-title">
          {t("walletEarlyWarningTitle")}
        </div>
        <div className="wallet-warning-body">{t("walletEarlyWarningBody")}</div>
        <button
          type="button"
          className="wallet-warning-support"
          onClick={onContactSupport}
        >
          <MessageCircle size={15} aria-hidden="true" />
          {t("walletHardwareSupportAction")}
        </button>
      </div>
    </div>
  );
}
