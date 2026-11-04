import { Keypad, Stack } from "@linky-fit/ui";
import type { ReactNode } from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { DisplayAmount } from "./DisplayAmount";
import type { AmountInput } from "./useAmountInputKeypad";

interface AmountKeypadProps {
  /** Sat, as `useAmountInputKeypad` keeps it. */
  amount: string;
  input: AmountInput;
  disabled?: boolean | undefined;
  /** Sits between the amount and the keys, e.g. the payment note. */
  below?: ReactNode;
}

/** The typed amount above the keypad that edits it. */
export function AmountKeypad({
  amount,
  input,
  disabled,
  below,
}: AmountKeypadProps) {
  const { t } = useTranslation();
  const { displayUnit } = useDisplayAmounts();
  const amountSat = Number.parseInt(amount.trim(), 10);
  return (
    <>
      {/* On phones the keys sit at the bottom, in thumb reach, with the amount centred above them. */}
      <Stack
        flexGrow={1}
        justifyContent="center"
        gap="$md"
        $wide={{ flexGrow: 0 }}
      >
        <Stack testID="amount-display" aria-live="polite" paddingVertical="$xl">
          <DisplayAmount
            amount={Number.isFinite(amountSat) && amountSat > 0 ? amountSat : 0}
            typedValue={input.inputDisplayValue}
            size="lg"
          />
        </Stack>
        {below}
      </Stack>
      <Keypad
        accessibilityLabel={`${t("payAmount")} (${displayUnit})`}
        decimal={input.decimalKeyEnabled}
        disabled={disabled}
        onKeyPress={input.onKeyPress}
        labels={{
          clear: t("clearForm"),
          decimal: t("decimalPoint"),
          delete: t("delete"),
        }}
      />
    </>
  );
}
