import { Button, Dialog } from "@linky-fit/ui";
import React from "react";
import { flushSync } from "react-dom";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { parseDefaultLightningAddressNpub } from "../derivedProfile";
import { navigateTo } from "../hooks/useRouting";

interface SaveContactPromptModalProps {
  amountSat: number;
  lnAddress: string;
  onClose: () => void;
  setContactNewPrefill: (prefill: {
    lnAddress: string;
    npub: string | null;
    suggestedName: string | null;
  }) => void;
}

export function SaveContactPromptModal({
  amountSat,
  lnAddress,
  onClose,
  setContactNewPrefill,
}: SaveContactPromptModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDisplayedAmountParts } = useDisplayAmounts();

  const displayAmount = formatDisplayedAmountParts(amountSat);

  const handleSave = () => {
    const ln = lnAddress.trim();
    const npub = parseDefaultLightningAddressNpub(ln);

    flushSync(() => {
      setContactNewPrefill({
        lnAddress: ln,
        npub,
        suggestedName: null,
      });
    });
    navigateTo({ route: "contactNew" });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("saveContactPromptTitle")}
      description={t("saveContactPromptBody")
        .replace(
          "{amount}",
          `${displayAmount.approxPrefix}${displayAmount.amountText}`,
        )
        .replace("{unit}", displayAmount.unitLabel)
        .replace("{lnAddress}", lnAddress)}
      actions={
        <>
          <Button onPress={handleSave}>{t("saveContactPromptSave")}</Button>
          <Button variant="secondary" onPress={onClose}>
            {t("saveContactPromptSkip")}
          </Button>
        </>
      }
    />
  );
}
