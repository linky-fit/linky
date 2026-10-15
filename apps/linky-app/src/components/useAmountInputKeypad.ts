import React from "react";
import { useDisplayAmounts } from "../app/hooks/shell";
import { readClipboardText } from "../platform/clipboard";
import { getDisplayFractionDigits } from "../utils/displayAmounts";

interface AmountInputDraft {
  amountSat: string;
  displayCurrency: string;
  displayValue: string;
}

interface UseAmountInputKeypadParams {
  amount: string;
  /** What the keypad shows for the initial `amount` in the current display unit, when known exactly. */
  initialDisplayValue?: string | null;
  onAmountChange: (amount: string) => void;
}

export interface AmountInput {
  decimalKeyEnabled: boolean;
  inputDisplayValue: string | null;
  onKeyPress: (key: string) => void;
  pasteFromClipboard: () => Promise<boolean>;
}

/** The clipboard text as keypad input, or null; `fractionDigits` 0 accepts whole numbers only. */
export const normalizePastedAmountInput = (
  value: string,
  fractionDigits: number,
): string | null => {
  const normalized = value.trim().replace(",", ".");
  const pattern =
    fractionDigits > 0
      ? new RegExp(`^\\d+(?:\\.\\d{0,${fractionDigits}})?$`)
      : /^\d+$/;
  return pattern.test(normalized) ? normalized : null;
};

export const useAmountInputKeypad = ({
  amount,
  initialDisplayValue = null,
  onAmountChange,
}: UseAmountInputKeypadParams): AmountInput => {
  const {
    applyAmountInputKeyWithDraft,
    decimalAmountInputKeyVisible,
    displayCurrency,
  } = useDisplayAmounts();
  const [draft, setDraft] = React.useState<AmountInputDraft | null>(() =>
    initialDisplayValue === null
      ? null
      : {
          amountSat: amount,
          displayCurrency,
          displayValue: initialDisplayValue,
        },
  );
  const currentDisplayValue =
    draft?.amountSat === amount && draft.displayCurrency === displayCurrency
      ? draft.displayValue
      : null;

  const onKeyPress = React.useCallback(
    (key: string) => {
      const result = applyAmountInputKeyWithDraft(
        amount,
        currentDisplayValue,
        key,
      );
      setDraft({
        amountSat: result.amountSat,
        displayCurrency,
        displayValue: result.displayValue,
      });
      onAmountChange(result.amountSat);
    },
    [
      amount,
      applyAmountInputKeyWithDraft,
      currentDisplayValue,
      displayCurrency,
      onAmountChange,
    ],
  );

  const pasteFromClipboard = React.useCallback(async () => {
    const clipboardText = await readClipboardText();
    if (clipboardText === null) return false;

    const pastedAmount = normalizePastedAmountInput(
      clipboardText,
      decimalAmountInputKeyVisible
        ? getDisplayFractionDigits(displayCurrency)
        : 0,
    );
    if (pastedAmount === null) return false;

    let result = { amountSat: "", displayValue: "" };
    for (const key of pastedAmount) {
      result = applyAmountInputKeyWithDraft(
        result.amountSat,
        result.displayValue,
        key,
      );
    }

    setDraft({
      amountSat: result.amountSat,
      displayCurrency,
      displayValue: result.displayValue,
    });
    onAmountChange(result.amountSat);
    return true;
  }, [
    applyAmountInputKeyWithDraft,
    decimalAmountInputKeyVisible,
    displayCurrency,
    onAmountChange,
  ]);

  return {
    decimalKeyEnabled: decimalAmountInputKeyVisible,
    inputDisplayValue: decimalAmountInputKeyVisible
      ? currentDisplayValue
      : null,
    onKeyPress,
    pasteFromClipboard,
  };
};
