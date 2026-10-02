import { TextField } from "@linky-fit/ui";
import type { FC } from "react";
import type { Translate } from "../i18n";

/** Fits a bolt11 description and the LUD-12 comment most providers allow. */
export const PAYMENT_NOTE_MAX_LENGTH = 140;

export interface PaymentNoteInputProps {
  disabled?: boolean | undefined;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
  t: Translate;
  value: string;
}

/** The optional note a payment or request carries, typed under the amount. */
export const PaymentNoteInput: FC<PaymentNoteInputProps> = ({
  disabled,
  maxLength,
  onChange,
  t,
  value,
}) => (
  <TextField
    testID="payment-note"
    label={t("paymentNoteLabel")}
    hideLabel
    placeholder={t("paymentNotePlaceholder")}
    value={value}
    onChangeText={onChange}
    maxLength={Math.min(
      maxLength ?? PAYMENT_NOTE_MAX_LENGTH,
      PAYMENT_NOTE_MAX_LENGTH,
    )}
    textAlign="center"
    autoComplete="off"
    autoCapitalize="sentences"
    enterKeyHint="done"
    disabled={disabled}
  />
);
