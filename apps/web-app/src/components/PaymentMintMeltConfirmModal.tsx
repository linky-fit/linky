import React from "react";
import type { Translate } from "../i18n";
import { formatMintHost } from "../utils/mint";
import { ModalSheet } from "./ModalSheet";

interface PaymentMintMeltConfirmModalProps {
  fromMint: string;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  t: Translate;
  toMint: string;
}

export function PaymentMintMeltConfirmModal({
  fromMint,
  isBusy,
  onClose,
  onConfirm,
  t,
  toMint,
}: PaymentMintMeltConfirmModalProps): React.ReactElement {
  return (
    <ModalSheet
      className="modal-overlay"
      aria-label={t("cashuPaymentMeltTitle")}
      onClick={onClose}
      sheetClassName="modal-sheet"
    >
      <div className="modal-title">{t("cashuPaymentMeltTitle")}</div>
      <div className="modal-body">
        {t("cashuPaymentMeltBody")
          .replace("{fromMint}", formatMintHost(fromMint))
          .replace("{toMint}", formatMintHost(toMint))}
      </div>
      <div className="modal-actions">
        <button
          className="btn-wide"
          disabled={isBusy}
          onClick={() => void onConfirm()}
        >
          {t("cashuPaymentMeltConfirm")}
        </button>
        <button
          className="btn-wide secondary"
          disabled={isBusy}
          onClick={onClose}
        >
          {t("payCancel")}
        </button>
      </div>
    </ModalSheet>
  );
}
