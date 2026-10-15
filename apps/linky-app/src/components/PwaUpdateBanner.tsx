import { Notice } from "@linky-fit/ui";
import React from "react";
import { applyPwaUpdate, subscribePwaNeedRefresh } from "../utils/pwaUpdate";
import type { Translate } from "../i18n";

interface PwaUpdateBannerProps {
  t: Translate;
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({ t }) => {
  const [needRefresh, setNeedRefresh] = React.useState(false);

  React.useEffect(() => subscribePwaNeedRefresh(setNeedRefresh), []);

  if (!needRefresh) return null;

  return (
    <Notice
      solid
      title={t("pwaUpdateAvailable")}
      icon="RefreshCcw"
      action={{
        label: t("pwaUpdateButton"),
        onPress: () => void applyPwaUpdate(),
      }}
    />
  );
};
