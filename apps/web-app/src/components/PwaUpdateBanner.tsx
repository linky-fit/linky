import React from "react";
import { applyPwaUpdate, subscribePwaNeedRefresh } from "../utils/pwaUpdate";
import type { Translate } from "../i18n";

interface PwaUpdateBannerProps {
  t: Translate;
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({ t }) => {
  const [needRefresh, setNeedRefresh] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    return subscribePwaNeedRefresh((value) => {
      setNeedRefresh(value);
    });
  }, []);

  if (!needRefresh) return null;

  const onClick = () => {
    if (applying) return;
    setApplying(true);
    void applyPwaUpdate();
  };

  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <span className="pwa-update-banner-text">{t("pwaUpdateAvailable")}</span>
      <button
        type="button"
        className="pwa-update-banner-button"
        onClick={onClick}
        disabled={applying}
      >
        {t("pwaUpdateButton")}
      </button>
    </div>
  );
};
