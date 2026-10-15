import { Notice } from "@linky-fit/ui";
import React from "react";
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
}: WalletWarningProps): React.ReactElement | null {
  if (dismissed) return null;
  return (
    <Notice
      tone="accent"
      icon="ShieldCheck"
      title={t("walletEarlyWarningTitle")}
      description={t("walletEarlyWarningBody")}
      action={{
        label: t("walletHardwareSupportAction"),
        onPress: onContactSupport,
      }}
      dismiss={{ label: t("close"), onPress: onDismiss }}
    />
  );
}
