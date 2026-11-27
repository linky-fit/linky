import { Button, Stack, Text } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import type { FC, ReactNode } from "react";
import type { Translate } from "../i18n";
import { AmountKeypad } from "./AmountKeypad";
import {
  PaymentNoteInput,
  type PaymentNoteInputProps,
} from "./PaymentNoteInput";
import { useAmountInputKeypad } from "./useAmountInputKeypad";

interface PaymentAmountPanelProps {
  amount: string;
  /** One quiet line under the amount, e.g. the allowed range or the fee; a blocked reason replaces it. */
  amountHint?: ReactNode | undefined;
  cashuIsBusy: boolean;
  header: ReactNode;
  /** Shown under the amount when the payment can carry a note. */
  note?: Omit<PaymentNoteInputProps, "t"> | undefined;
  notices?: ReactNode | undefined;
  onAmountChange: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
  sendGuideId?: string | undefined;
  stepGuideId?: string | undefined;
  submitBusy?: boolean | undefined;
  submitDisabled: boolean;
  /** Why the amount cannot be sent, e.g. not enough funds. */
  submitBlockedReason?: string | undefined;
  submitIcon?: IconName | undefined;
  submitLabel?: string | undefined;
  t: Translate;
}

export const PaymentAmountPanel: FC<PaymentAmountPanelProps> = ({
  amount,
  amountHint,
  cashuIsBusy,
  header,
  note,
  notices,
  onAmountChange,
  onSubmit,
  sendGuideId,
  stepGuideId,
  submitBusy,
  submitDisabled,
  submitBlockedReason,
  submitIcon,
  submitLabel,
  t,
}) => {
  const amountInput = useAmountInputKeypad({ amount, onAmountChange });

  return (
    <Stack
      gap="$md"
      flexGrow={1}
      width="100%"
      maxWidth="$form"
      alignSelf="center"
      $wide={{ justifyContent: "center" }}
    >
      {header}
      {notices}

      <Stack
        gap="$md"
        flexGrow={1}
        $wide={{ flexGrow: 0 }}
        data-guide={stepGuideId}
      >
        <AmountKeypad
          amount={amount}
          input={amountInput}
          disabled={cashuIsBusy}
          below={
            <>
              {/* Fixed height, so a blocked reason never moves the keys under a typing thumb. */}
              <Stack
                minHeight={32}
                justifyContent="center"
                alignItems="center"
                aria-live="polite"
              >
                {submitBlockedReason ? (
                  <Text
                    variant="caption"
                    bold
                    color="$danger"
                    textAlign="center"
                    numberOfLines={2}
                    testID="payment-blocked-reason"
                  >
                    {submitBlockedReason}
                  </Text>
                ) : (
                  amountHint
                )}
              </Stack>
              {note ? <PaymentNoteInput {...note} t={t} /> : null}
            </>
          }
        />

        <Button
          icon={submitIcon ?? "HandCoins"}
          loading={submitBusy ?? cashuIsBusy}
          onPress={onSubmit}
          disabled={cashuIsBusy || submitDisabled}
          data-guide={sendGuideId}
          tooltip={submitBlockedReason}
        >
          {submitLabel ?? t("paySend")}
        </Button>
      </Stack>
    </Stack>
  );
};
