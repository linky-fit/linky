import { Amount, Pressable, Stack } from "@linky-fit/ui";
import type { AmountProps } from "@linky-fit/ui";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import type { Lang } from "../i18n";
import type { DisplayAmountParts } from "../utils/displayAmounts";

interface DisplayAmountProps {
  /** Sat, shown in the display unit; text is an amount without a sat value and shows as is. */
  amount: number | string;
  /** Whether a tap switches the display unit; defaults to sat amounts only. */
  cycles?: boolean | undefined;
  /** The keypad input in the display unit, shown as typed, e.g. with a trailing decimal point. */
  typedValue?: string | null | undefined;
  /** Replaces the conversion of `amount`, e.g. a payment fixed in fiat shown exactly in its own currency. */
  parts?: DisplayAmountParts | undefined;
  caption?: string | undefined;
  size?: AmountProps["size"];
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}

/** Value and unit of a sat amount; keypad input shows as typed, e.g. "12.". */
const satAmount = (
  parts: DisplayAmountParts,
  typedValue: string | null,
  lang: Lang,
) => ({
  value:
    typedValue === null
      ? `${parts.approxPrefix}${parts.amountText}`
      : `${Number(typedValue) > 0 ? parts.approxPrefix : ""}${
          lang === "en" ? typedValue : typedValue.replace(".", ",")
        }`,
  unit: parts.unitLabel,
});

/** A hero amount in the user's display unit. */
export function DisplayAmount({
  amount,
  cycles = typeof amount === "number",
  typedValue = null,
  parts,
  caption,
  size = "md",
  accessibilityLabel,
  testID,
}: DisplayAmountProps) {
  const { allowedDisplayCurrencies, formatDisplayedAmountParts, lang, t } =
    useAppShellCore();
  const { cycleDisplayCurrency } = useAppShellActions();
  const content = (
    <Amount
      {...(typeof amount === "string"
        ? { value: amount }
        : satAmount(
            parts ?? formatDisplayedAmountParts(amount),
            typedValue,
            lang,
          ))}
      caption={caption}
      size={size}
    />
  );
  const frame = {
    testID,
    "aria-label": accessibilityLabel,
    alignSelf: "center",
  } as const;

  if (!cycles || allowedDisplayCurrencies.length <= 1) {
    return <Stack {...frame}>{content}</Stack>;
  }
  return (
    <Pressable
      {...frame}
      tooltip={t("unitCycleAction")}
      onPress={cycleDisplayCurrency}
    >
      {content}
    </Pressable>
  );
}
