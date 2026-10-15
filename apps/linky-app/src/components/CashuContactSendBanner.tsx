import { Notice } from "@linky-fit/ui";
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

  return (
    <Notice
      solid
      title={t("cashuContactSendPendingBanner").replace("{amount}", amountText)}
      icon="Send"
      action={{ label: t("cancel"), onPress: onCancel }}
    />
  );
};
