import React from "react";
import type { Translate } from "../i18n";
import { ModalSheet } from "./ModalSheet";

interface ShareOptionsModalProps {
  onClose: () => void;
  onCopy: () => void;
  onEmail: () => void;
  onSms: () => void;
  onWhatsApp: () => void;
  shareText: string;
  t: Translate;
}

export function ShareOptionsModal({
  onClose,
  onCopy,
  onEmail,
  onSms,
  onWhatsApp,
  shareText,
  t,
}: ShareOptionsModalProps): React.ReactElement {
  return (
    <ModalSheet
      className="modal-overlay"
      aria-label={t("shareOptionsTitle")}
      onClick={onClose}
      sheetClassName="modal-sheet share-options-sheet"
    >
      <div className="modal-header">
        <div className="modal-title">{t("shareOptionsTitle")}</div>
        <button
          type="button"
          className="nfc-write-close"
          onClick={onClose}
          aria-label={t("close")}
          title={t("close")}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <p className="modal-body">{t("shareOptionsBody")}</p>
      <textarea className="share-options-preview" readOnly value={shareText} />

      <div className="modal-actions share-options-actions">
        <button type="button" className="btn-wide" onClick={onWhatsApp}>
          {t("shareViaWhatsApp")}
        </button>
        <button type="button" className="btn-wide secondary" onClick={onSms}>
          {t("shareViaSms")}
        </button>
        <button type="button" className="btn-wide secondary" onClick={onEmail}>
          {t("shareViaEmail")}
        </button>
        <button type="button" className="btn-wide secondary" onClick={onCopy}>
          {t("copy")}
        </button>
        <button type="button" className="btn-wide secondary" onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </ModalSheet>
  );
}
