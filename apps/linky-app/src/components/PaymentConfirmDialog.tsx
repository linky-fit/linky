import { Button, Dialog, Notice, Progress, Stack, Text } from "@linky-fit/ui";
import type { ReactNode } from "react";
import type { DisplayAmountParts } from "../utils/displayAmounts";
import { DisplayAmount } from "./DisplayAmount";

interface PaymentConfirmDialogProps {
  amountSat: number | null;
  /** Shown instead of converting `amountSat`, for a payment fixed in another unit. */
  amountParts?: DisplayAmountParts | undefined;
  cancelLabel: string;
  /** False keeps a tap outside the sheet from counting as Cancel. */
  closeOnBackdrop?: boolean;
  confirmLabel: string;
  /** 0..1 progress shown above the confirm button, for a confirm that fires on its own when it reaches 1. */
  confirmProgress?: number | null;
  description: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  isBusy: boolean;
  label: string;
  /** "amount-first" (default) or "description-first": the amount then sits under the description. */
  layout?: "amount-first" | "description-first";
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
  cancelLabel,
  closeOnBackdrop = true,
  confirmLabel,
  confirmProgress = null,
  description,
  disabled = false,
  disabledReason,
  isBusy,
  label,
  layout = "amount-first",
  meta,
  onClose,
  onConfirm,
  unknownAmountLabel,
}: PaymentConfirmDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && closeOnBackdrop) onClose();
      }}
      title={label}
      hideTitle
      actions={
        <>
          {confirmProgress === null ? null : (
            <Progress
              value={confirmProgress}
              transition="countdown"
              accessibilityLabel={confirmLabel}
            />
          )}
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
        {layout === "description-first" && description
          ? caption(description)
          : null}
        {amountSat === null ? (
          <Text variant="heading" color="$color" textAlign="center">
            {unknownAmountLabel}
          </Text>
        ) : (
          <DisplayAmount
            amount={amountSat}
            parts={amountParts}
            accessibilityLabel={label}
          />
        )}
        {layout === "amount-first" && description ? caption(description) : null}
        {meta ? caption(meta, true) : null}
        {disabled && disabledReason ? (
          <Notice tone="accent" icon="CircleAlert" title={disabledReason} />
        ) : null}
      </Stack>
    </Dialog>
  );
}
