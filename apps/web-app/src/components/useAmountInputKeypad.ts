import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { readClipboardText } from "../platform/clipboard";

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

interface UseAmountInputKeypadResult {
  decimalKeyEnabled: boolean;
  inputDisplayValue: string | null;
  onKeyPress: (key: string) => void;
  pasteFromClipboard: () => Promise<boolean>;
}

export const normalizePastedAmountInput = (
  value: string,
  allowDecimals: boolean,
): string | null => {
  const normalized = value.trim().replace(",", ".");
  const pattern = allowDecimals ? /^\d+(?:\.\d{0,2})?$/ : /^\d+$/;
  return pattern.test(normalized) ? normalized : null;
};

export const useAmountInputKeypad = ({
  amount,
  initialDisplayValue = null,
  onAmountChange,
}: UseAmountInputKeypadParams): UseAmountInputKeypadResult => {
  const {
    applyAmountInputKeyWithDraft,
    decimalAmountInputKeyVisible,
    displayCurrency,
  } = useAppShellCore();
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
      decimalAmountInputKeyVisible,
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
