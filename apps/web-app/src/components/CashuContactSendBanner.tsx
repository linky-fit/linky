import React from "react";
import type { Translate } from "../i18n";

interface CashuContactSendBannerProps {
  amountText: string | null;
  onCancel: () => void;
  t: Translate;
}

export const CashuContactSendBanner: React.FC<CashuContactSendBannerProps> = ({
  amountText,
  onCancel,
  t,
}) => {
  if (!amountText) return null;

  const message = t("cashuContactSendPendingBanner").replace(
    "{amount}",
    amountText,
  );

  return (
    <div
      className="pwa-update-banner cashu-contact-send-banner"
      role="status"
      aria-live="polite"
    >
      <span className="pwa-update-banner-text">{message}</span>
      <button
        type="button"
        className="pwa-update-banner-button"
        onClick={onCancel}
        aria-label={t("cancel")}
      >
        {t("cancel")}
      </button>
    </div>
  );
};
