import { HandCoins as PayIcon } from "lucide-react";
import type { FC, ReactNode } from "react";
import { AmountDisplay } from "./AmountDisplay";

import type { Translate } from "../i18n";
import { Keypad } from "./Keypad";
import { useAmountInputKeypad } from "./useAmountInputKeypad";

interface PaymentAmountPanelProps {
  amount: string;
  cashuIsBusy: boolean;
  displayUnit: string;
  header: ReactNode;
  notices?: ReactNode | undefined;
  onAmountChange: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
  sendGuideId?: string | undefined;
  stepGuideId?: string | undefined;
  submitBusy?: boolean | undefined;
  submitDisabled: boolean;
  submitIcon?: ReactNode | undefined;
  submitLabel?: string | undefined;
  submitTitle?: string | undefined;
  t: Translate;
}

export const PaymentAmountPanel: FC<PaymentAmountPanelProps> = ({
  amount,
  cashuIsBusy,
  displayUnit,
  header,
  notices,
  onAmountChange,
  onSubmit,
  sendGuideId,
  stepGuideId,
  submitBusy,
  submitDisabled,
  submitIcon,
  submitLabel,
  submitTitle,
  t,
}) => {
  const isSubmitBusy = submitBusy ?? cashuIsBusy;
  const amountInput = useAmountInputKeypad({
    amount,
    onAmountChange: (nextAmount) => onAmountChange(nextAmount),
  });

  return (
    <section className="panel">
      {header}
      {notices}

      <div {...(stepGuideId ? { "data-guide": stepGuideId } : {})}>
        <AmountDisplay
          amount={amount}
          cycleOnClick
          inputDisplayValue={amountInput.inputDisplayValue}
        />

        <Keypad
          ariaLabel={`${t("payAmount")} (${displayUnit})`}
          decimalKeyEnabled={amountInput.decimalKeyEnabled}
          disabled={cashuIsBusy}
          onKeyPress={(key: string) => {
            if (cashuIsBusy) return;
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
            onClick={onSubmit}
            disabled={cashuIsBusy || submitDisabled}
            title={submitTitle}
            {...(sendGuideId ? { "data-guide": sendGuideId } : {})}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                {isSubmitBusy ? (
                  <span className="btn-spinner" />
                ) : (
                  (submitIcon ?? <PayIcon size={18} />)
                )}
              </span>
              <span>
                {isSubmitBusy ? t("payPaying") : (submitLabel ?? t("paySend"))}
              </span>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};
