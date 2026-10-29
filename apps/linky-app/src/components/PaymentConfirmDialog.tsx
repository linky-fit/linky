import { Button, Dialog, Notice, Stack, Text } from "@linky-fit/ui";
import type { ReactNode } from "react";
import type { DisplayAmountParts } from "../utils/displayAmounts";
import { DisplayAmount } from "./DisplayAmount";

interface PaymentConfirmDialogProps {
  amountSat: number | null;
  /** Shown instead of converting `amountSat`, for a payment fixed in another unit. */
  amountParts?: DisplayAmountParts | undefined;
  /** Shown under the amount, e.g. its fiat value beside exact sats. */
  amountCaption?: string | undefined;
  cancelLabel: string;
  confirmLabel: string;
  description: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  isBusy: boolean;
  label: string;
  meta?: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  unknownAmountLabel?: string;
}

const caption = (content: ReactNode, bold = false) =>
  typeof content === "string" ? (
    <Text variant="caption" bold={bold} color="$colorMuted" textAlign="center">
      {content}
    </Text>
  ) : (
    content
  );

export function PaymentConfirmDialog({
  amountSat,
  amountParts,
  amountCaption,
  cancelLabel,
  confirmLabel,
  description,
  disabled = false,
  disabledReason,
  isBusy,
  label,
  meta,
  onClose,
  onConfirm,
  unknownAmountLabel,
}: PaymentConfirmDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={label}
      hideTitle
      actions={
        <>
          <Button
            loading={isBusy}
            onPress={() => void onConfirm()}
            disabled={disabled}
            tooltip={disabledReason}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" onPress={onClose} disabled={isBusy}>
            {cancelLabel}
          </Button>
        </>
      }
    >
      <Stack alignItems="center" gap="$sm" paddingBottom="$lg">
        {amountSat === null ? (
          <Text variant="heading" color="$color" textAlign="center">
            {unknownAmountLabel}
          </Text>
        ) : (
          <DisplayAmount
            amount={amountSat}
            parts={amountParts}
            caption={amountCaption}
            accessibilityLabel={label}
          />
        )}
        {description ? caption(description) : null}
        {meta ? caption(meta, true) : null}
        {disabled && disabledReason ? (
          <Notice tone="accent" icon="CircleAlert" title={disabledReason} />
        ) : null}
      </Stack>
    </Dialog>
  );
}
