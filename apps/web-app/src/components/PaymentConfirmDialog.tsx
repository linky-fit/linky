import type { ReactNode } from "react";
import { ModalSheet } from "./ModalSheet";
import { WalletBalance } from "./WalletBalance";

interface PaymentConfirmDialogProps {
  amountSat: number | null;
  cancelLabel: string;
  confirmLabel: string;
  description: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  isBusy: boolean;
  label: string;
  meta?: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  unknownAmountLabel?: string;
}

export function PaymentConfirmDialog({
  amountSat,
  cancelLabel,
  confirmLabel,
  description,
  disabled = false,
  disabledReason,
  isBusy,
  label,
  meta,
  onClose,
  onConfirm,
  unknownAmountLabel,
}: PaymentConfirmDialogProps) {
  return (
    <ModalSheet
      aria-label={label}
      onClick={onClose}
      sheetClassName="modal-sheet lightning-invoice-confirm-sheet"
    >
      <div className="lightning-invoice-confirm-summary">
        <div className="lightning-invoice-confirm-amount">
          {amountSat === null ? (
            <div className="lightning-invoice-confirm-unknown-amount">
              {unknownAmountLabel}
            </div>
          ) : (
            <WalletBalance ariaLabel={label} balance={amountSat} />
          )}
        </div>
        <div className="lightning-invoice-confirm-meta">
          {description ? (
            <div className="lightning-invoice-confirm-description">
              {description}
            </div>
          ) : null}
          {meta ? (
            <div className="lightning-invoice-confirm-expiry muted">{meta}</div>
          ) : null}
        </div>
      </div>
      <div className="modal-actions">
        <button
          className="btn-wide"
          onClick={() => void onConfirm()}
          disabled={isBusy || disabled}
          title={disabledReason}
        >
          {confirmLabel}
        </button>
        <button
          className="btn-wide secondary"
          onClick={onClose}
          disabled={isBusy}
        >
          {cancelLabel}
        </button>
      </div>
    </ModalSheet>
  );
}
