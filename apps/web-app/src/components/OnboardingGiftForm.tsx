import { Gift } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { OnboardingGift } from "../utils/onboardingGift";
import { AmountDisplay } from "./AmountDisplay";
import { Keypad } from "./Keypad";
import { SettingsToggleRow } from "./SettingsRows";
import { useAmountInputKeypad } from "./useAmountInputKeypad";

interface OnboardingGiftFormProps {
  initial: OnboardingGift;
  onSubmit: (gift: OnboardingGift) => void;
  submitLabel: string;
}

/** Toggle plus keypad for the welcome gift, shared by settings and the first onboarding. */
export function OnboardingGiftForm({
  initial,
  onSubmit,
  submitLabel,
}: OnboardingGiftFormProps): React.ReactElement {
  const { displayUnit, t } = useAppShellCore();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [amount, setAmount] = React.useState(() =>
    initial.amountSat > 0 ? String(initial.amountSat) : "",
  );
  const amountSat = Number.parseInt(amount.trim(), 10);
  const amountInvalid = !Number.isFinite(amountSat) || amountSat <= 0;
  const amountInput = useAmountInputKeypad({
    amount,
    onAmountChange: setAmount,
  });

  return (
    <>
      <SettingsToggleRow
        icon={<Gift size={18} />}
        label={t("onboardGiftEnabled")}
        checked={enabled}
        onChange={setEnabled}
      />

      {enabled ? (
        <>
          <AmountDisplay
            amount={amount}
            inputDisplayValue={amountInput.inputDisplayValue}
          />

          <Keypad
            ariaLabel={`${t("onboardGiftAmount")} (${displayUnit})`}
            decimalKeyEnabled={amountInput.decimalKeyEnabled}
            disabled={false}
            onKeyPress={amountInput.onKeyPress}
            translations={{
              clearForm: t("clearForm"),
              decimalPoint: t("decimalPoint"),
              delete: t("delete"),
            }}
          />
        </>
      ) : null}

      <div className="actions">
        <button
          className="btn-wide"
          onClick={() =>
            onSubmit({
              amountSat: enabled ? amountSat : initial.amountSat,
              enabled,
            })
          }
          disabled={enabled && amountInvalid}
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
}
