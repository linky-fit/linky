import { Radio as NfcIcon } from "lucide-react";
import React from "react";
import { ModalSheet } from "./ModalSheet";

import type { Translate } from "../i18n";

interface NfcWriteModalProps {
  kind: "profile" | "token";
  onCancel: () => void;
  t: Translate;
}

export function NfcWriteModal({
  kind,
  onCancel,
  t,
}: NfcWriteModalProps): React.ReactElement {
  const detailKey =
    kind === "profile" ? "nfcWriteReadyProfileBody" : "nfcWriteReadyTokenBody";
  const actionKey =
    kind === "profile" ? "nfcWriteProfileLabel" : "nfcWriteTokenLabel";

  return (
    <ModalSheet
      className="modal-overlay nfc-write-overlay"
      aria-label={t("nfcWriteReadyTitle")}
      onClick={onCancel}
      sheetClassName="modal-sheet nfc-write-sheet"
    >
      <div className="nfc-write-header">
        <button
          type="button"
          className="nfc-write-close"
          onClick={onCancel}
          aria-label={t("close")}
          title={t("close")}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="nfc-write-stage">
        <div className="modal-title nfc-write-title">
          {t("nfcWriteReadyTitle")}
        </div>
        <p className="nfc-write-subtitle">{t("nfcWriteReadySubtitle")}</p>

        <div className="nfc-write-illustration" aria-hidden="true">
          <div className="nfc-write-illustrationRing">
            <div className="nfc-write-phone">
              <div className="nfc-write-phone-speaker" />
              <div className="nfc-write-phone-screen" />
            </div>
            <div className="nfc-write-signal">
              <NfcIcon />
            </div>
          </div>
        </div>

        <div className="nfc-write-copy">
          <p className="nfc-write-label">{t(actionKey)}</p>
          <p className="modal-body nfc-write-body">{t(detailKey)}</p>
        </div>
      </div>

      <div className="modal-actions nfc-write-actions">
        <button
          type="button"
          className="btn-wide nfc-write-cancel"
          onClick={onCancel}
        >
          {t("payCancel")}
        </button>
      </div>
    </ModalSheet>
  );
}
