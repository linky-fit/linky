import { Button, Dialog } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { formatMintHost } from "../utils/mint";

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("cashuPaymentMeltTitle")}
      description={t("cashuPaymentMeltBody")
        .replace("{fromMint}", formatMintHost(fromMint))
        .replace("{toMint}", formatMintHost(toMint))}
      actions={
        <>
          <Button loading={isBusy} onPress={() => void onConfirm()}>
            {t("cashuPaymentMeltConfirm")}
          </Button>
          <Button variant="secondary" disabled={isBusy} onPress={onClose}>
            {t("payCancel")}
          </Button>
        </>
      }
    />
  );
}
