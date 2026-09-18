import { Button, Notice, Stack } from "@linky-fit/ui";
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
  cashuIsBusy: boolean;
  /** Rendered under the submit button (secondary links). */
  footer?: ReactNode | undefined;
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
  cashuIsBusy,
  footer,
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
    <Stack gap="$md">
      {header}
      {notices}

      <Stack gap="$md" data-guide={stepGuideId}>
        <AmountKeypad
          amount={amount}
          input={amountInput}
          disabled={cashuIsBusy}
          below={note ? <PaymentNoteInput {...note} t={t} /> : undefined}
        />

        {submitBlockedReason ? (
          <Notice
            tone="accent"
            icon="CircleAlert"
            title={submitBlockedReason}
          />
        ) : null}

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
        {footer}
      </Stack>
    </Stack>
  );
};
