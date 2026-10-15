import { Icon, Pill } from "@linky-fit/ui";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";

interface MintPendingPillProps {
  /** Sats waiting for their mint; they are not part of any balance. */
  amount: number;
  testID: string;
  size?: "sm" | "md";
  onPress?: (() => void) | undefined;
}

export function MintPendingPill({
  amount,
  testID,
  size = "md",
  onPress,
}: MintPendingPillProps) {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  return (
    <Pill
      testID={testID}
      tone="warning"
      size={size}
      leading={<Icon name="Clock" size="sm" color="$warningText" />}
      label={t("mintPendingAmount").replace(
        "{amount}",
        formatDisplayedAmountText(amount),
      )}
      onPress={onPress}
    />
  );
}
