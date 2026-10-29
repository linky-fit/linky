import React from "react";
import type { Translate } from "../i18n";
import { formatMintHost } from "../utils/mint";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";

interface PaymentMintMeltConfirmModalProps {
  fromMint: string;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  t: Translate;
  toMint: string;
}

/** Asks to move funds to the main mint first, in the same dialog every payment confirms in. */
export function PaymentMintMeltConfirmModal({
  fromMint,
  isBusy,
  onClose,
  onConfirm,
  t,
  toMint,
}: PaymentMintMeltConfirmModalProps): React.ReactElement {
  return (
    <PaymentConfirmDialog
      amountSat={null}
      unknownAmountLabel={t("cashuPaymentMeltTitle")}
      label={t("cashuPaymentMeltTitle")}
      confirmLabel={t("cashuPaymentMeltConfirm")}
      cancelLabel={t("payCancel")}
      description={t("cashuPaymentMeltBody")
        .replace("{fromMint}", formatMintHost(fromMint))
        .replace("{toMint}", formatMintHost(toMint))}
      isBusy={isBusy}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
