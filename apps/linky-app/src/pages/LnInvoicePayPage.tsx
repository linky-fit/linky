import { getLightningInvoicePreview } from "@linky-fit/linkshu";
import { Button, Stack, Text } from "@linky-fit/ui";
import React, { type FC } from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { LightningFeeHint } from "../components/LightningFeeHint";
import { PaymentAmountPanel } from "../components/PaymentAmountPanel";
import { formatMiddleDots } from "../utils/formatting";

interface LnInvoicePayPageProps {
  invoice: string;
  payLightningInvoiceWithCashu: (
    invoice: string,
    amountSat: number,
  ) => Promise<boolean>;
}

/** The amount for a Lightning invoice that names none; Send pays it at once. */
export const LnInvoicePayPage: FC<LnInvoicePayPageProps> = ({
  invoice,
  payLightningInvoiceWithCashu,
}) => {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const { canPayWithCashu, cashuBalance, cashuBalanceAfterMelt, cashuIsBusy } =
    useWalletBalance();
  const [amount, setAmount] = React.useState("");
  const description = React.useMemo(
    () => getLightningInvoicePreview(invoice)?.description ?? null,
    [invoice],
  );

  const amountSat = Number.parseInt(amount.trim(), 10);
  const invalid =
    !canPayWithCashu ||
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    amountSat > cashuBalanceAfterMelt;

  return (
    <PaymentAmountPanel
      amount={amount}
      cashuIsBusy={cashuIsBusy}
      header={
        <Stack gap="$xxs">
          {description ? (
            <Text variant="title" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
          <Text color="$colorMuted">{formatMiddleDots(invoice, 36)}</Text>
          <Button
            variant="ghost"
            size="sm"
            alignSelf="flex-start"
            disabled={cashuBalance <= 0}
            onPress={() => setAmount(String(cashuBalance))}
          >
            {`${t("availablePrefix")} ${formatDisplayedAmountText(cashuBalance)}`}
          </Button>
        </Stack>
      }
      notices={
        amountSat > 0 ? <LightningFeeHint amountSat={amountSat} /> : null
      }
      onAmountChange={setAmount}
      onSubmit={() => {
        if (invalid) return;
        void payLightningInvoiceWithCashu(invoice, amountSat);
      }}
      submitDisabled={invalid}
      submitBlockedReason={
        amountSat > cashuBalanceAfterMelt ? t("payInsufficient") : undefined
      }
      t={t}
    />
  );
};

export const LnInvoicePayRoute: FC<Pick<LnInvoicePayPageProps, "invoice">> = ({
  invoice,
}) => {
  const { payLightningInvoiceWithCashu } = useWalletCommands();
  return (
    <LnInvoicePayPage
      invoice={invoice}
      payLightningInvoiceWithCashu={payLightningInvoiceWithCashu}
    />
  );
};
