import { Stack, Button } from "@linky-fit/ui";
import type { FC } from "react";
import { useState } from "react";
import { useTranslation } from "../app/hooks/shell";
import { useAtom } from "@linky-fit/linkstr-react";
import { lightningInvoiceAutoPayLimitAtom } from "../app/state/wallet/prefs";
import { AmountKeypad } from "../components/AmountKeypad";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";

export const AdvancedAutoPayLimitPage: FC = () => {
  const [lightningInvoiceAutoPayLimit, setLightningInvoiceAutoPayLimit] =
    useAtom(lightningInvoiceAutoPayLimitAtom);
  const { t } = useTranslation();

  const [amount, setAmount] = useState<string>(() =>
    lightningInvoiceAutoPayLimit > 0
      ? String(lightningInvoiceAutoPayLimit)
      : "",
  );
  const amountSat = Number.parseInt(amount.trim(), 10);
  const invalid = !Number.isFinite(amountSat) || amountSat <= 0;
  const amountInput = useAmountInputKeypad({
    amount,
    onAmountChange: setAmount,
  });

  return (
    <Stack>
      <AmountKeypad amount={amount} input={amountInput} />

      <Stack>
        <Button
          onPress={() => {
            if (invalid) return;
            setLightningInvoiceAutoPayLimit(amountSat);
            navigateTo({ route: "advanced" });
          }}
          disabled={invalid}
        >
          {t("saveChanges")}
        </Button>
      </Stack>
    </Stack>
  );
};
