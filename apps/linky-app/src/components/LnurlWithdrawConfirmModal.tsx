import React from "react";
import type { Translate } from "../i18n";
import type { LnurlWithdrawPreview } from "../lnurlPay";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";

interface LnurlWithdrawConfirmModalProps {
  confirmation: LnurlWithdrawPreview;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  t: Translate;
}

export function LnurlWithdrawConfirmModal({
  confirmation,
  isBusy,
  onClose,
  onConfirm,
  t,
}: LnurlWithdrawConfirmModalProps): React.ReactElement {
  const hasVariableAmount =
    confirmation.minAmountSat !== confirmation.maxAmountSat;

  return (
    <PaymentConfirmDialog
      amountSat={confirmation.amountSat}
      label={t("walletReceive")}
      confirmLabel={t("walletReceive")}
      cancelLabel={t("payCancel")}
      description={confirmation.description ?? confirmation.target}
      meta={hasVariableAmount ? t("lnurlWithdrawVariableAmount") : null}
      isBusy={isBusy}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
