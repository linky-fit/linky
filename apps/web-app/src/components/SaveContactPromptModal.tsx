import React from "react";
import { flushSync } from "react-dom";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { parseDefaultLightningAddressNpub } from "../derivedProfile";
import { navigateTo } from "../hooks/useRouting";
import { ModalSheet } from "./ModalSheet";

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
  const { formatDisplayedAmountParts, t } = useAppShellCore();

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
    <ModalSheet
      className="modal-overlay"
      aria-label={t("saveContactPromptTitle")}
      sheetClassName="modal-sheet"
    >
      <div className="modal-title">{t("saveContactPromptTitle")}</div>
      <div className="modal-body">
        {t("saveContactPromptBody")
          .replace(
            "{amount}",
            `${displayAmount.approxPrefix}${displayAmount.amountText}`,
          )
          .replace("{unit}", displayAmount.unitLabel)
          .replace("{lnAddress}", lnAddress)}
      </div>
      <div className="modal-actions">
        <button className="btn-wide" onClick={handleSave}>
          {t("saveContactPromptSave")}
        </button>
        <button className="btn-wide secondary" onClick={onClose}>
          {t("saveContactPromptSkip")}
        </button>
      </div>
    </ModalSheet>
  );
}
