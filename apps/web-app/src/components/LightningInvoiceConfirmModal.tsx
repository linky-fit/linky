import React from "react";
import type { Translate } from "../i18n";
import type { LightningInvoicePreview } from "@linky/linkshu";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";

interface LightningInvoiceConfirmModalProps {
  cashuBalance: number;
  cashuIsBusy: boolean;
  confirmation: LightningInvoicePreview;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  t: Translate;
}

const formatRemainingLifetime = (
  remainingSeconds: number | null,
): string | null => {
  if (
    !Number.isFinite(remainingSeconds) ||
    remainingSeconds === null ||
    remainingSeconds < 0
  ) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export function LightningInvoiceConfirmModal({
  cashuBalance,
  cashuIsBusy,
  confirmation,
  onClose,
  onConfirm,
  t,
}: LightningInvoiceConfirmModalProps): React.ReactElement {
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (confirmation.expiresAtSec === null) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [confirmation.expiresAtSec]);

  const expiresLabel = formatRemainingLifetime(
    confirmation.expiresAtSec === null
      ? null
      : confirmation.expiresAtSec - nowMs / 1000,
  );
  const insufficientBalance =
    confirmation.amountSat !== null && confirmation.amountSat > cashuBalance;

  return (
    <PaymentConfirmDialog
      amountSat={confirmation.amountSat}
      label={t("pay")}
      confirmLabel={t("paySend")}
      cancelLabel={t("payCancel")}
      description={confirmation.description}
      meta={expiresLabel}
      unknownAmountLabel={t("lightningInvoiceConfirmUnknownAmount")}
      isBusy={cashuIsBusy}
      disabled={insufficientBalance}
      {...(insufficientBalance ? { disabledReason: t("payInsufficient") } : {})}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
