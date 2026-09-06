import type { FC } from "react";
import { useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { AmountDisplay } from "../components/AmountDisplay";
import { Keypad } from "../components/Keypad";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";

export const AdvancedAutoPayLimitPage: FC = () => {
  const { lightningInvoiceAutoPayLimit, setLightningInvoiceAutoPayLimit } =
    useAdvancedSettingsContext();
  const { displayUnit, t } = useAppShellCore();

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
    <section className="panel">
      <AmountDisplay
        amount={amount}
        inputDisplayValue={amountInput.inputDisplayValue}
      />

      <Keypad
        ariaLabel={`${t("payAmount")} (${displayUnit})`}
        decimalKeyEnabled={amountInput.decimalKeyEnabled}
        disabled={false}
        onKeyPress={(key: string) => {
          amountInput.onKeyPress(key);
        }}
        translations={{
          clearForm: t("clearForm"),
          decimalPoint: t("decimalPoint"),
          delete: t("delete"),
        }}
      />

      <div className="actions">
        <button
          className="btn-wide"
          onClick={() => {
            if (invalid) return;
            setLightningInvoiceAutoPayLimit(amountSat);
            navigateTo({ route: "advanced" });
          }}
          disabled={invalid}
        >
          {t("saveChanges")}
        </button>
      </div>
    </section>
  );
};
