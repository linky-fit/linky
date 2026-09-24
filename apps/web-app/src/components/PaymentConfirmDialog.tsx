import type { ReactNode } from "react";
import { ModalSheet } from "./ModalSheet";
import { WalletBalance } from "./WalletBalance";

interface PaymentConfirmDialogProps {
  amountSat: number | null;
  cancelLabel: string;
  /** False keeps a tap outside the sheet from counting as Cancel. */
  closeOnBackdrop?: boolean;
  confirmLabel: string;
  /** 0..1 fill behind the confirm label, for a confirm that fires on its own when it reaches 1. */
  confirmProgress?: number | null;
  description: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  isBusy: boolean;
  label: string;
  /** "amount-first" (default) or "description-first": the amount then sits under the description. */
  layout?: "amount-first" | "description-first";
  meta?: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  unknownAmountLabel?: string;
}

export function PaymentConfirmDialog({
  amountSat,
  cancelLabel,
  closeOnBackdrop = true,
  confirmLabel,
  confirmProgress = null,
  description,
  disabled = false,
  disabledReason,
  isBusy,
  label,
  layout = "amount-first",
  meta,
  onClose,
  onConfirm,
  unknownAmountLabel,
}: PaymentConfirmDialogProps) {
  return (
    <ModalSheet
      aria-label={label}
      {...(closeOnBackdrop ? { onClick: onClose } : {})}
      sheetClassName="modal-sheet lightning-invoice-confirm-sheet"
    >
      <div
        className={`lightning-invoice-confirm-summary${layout === "description-first" ? " is-description-first" : ""}`}
      >
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
          className={
            confirmProgress === null ? "btn-wide" : "btn-wide btn-progress-host"
          }
          onClick={() => void onConfirm()}
          disabled={isBusy || disabled}
          title={disabledReason}
        >
          {confirmProgress === null ? null : (
            <span
              className="btn-progress"
              aria-hidden="true"
              style={{
                transform: `scaleX(${Math.min(1, Math.max(0, confirmProgress))})`,
              }}
            />
          )}
          <span className="btn-progress-label">{confirmLabel}</span>
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
