import { Pressable, Stack } from "@linky-fit/ui";
import type { ReactNode } from "react";
import { useDisplayCurrencyCycle, useTranslation } from "../app/hooks/shell";

interface UnitCyclePressableProps {
  children: ReactNode;
  /** Whether the content depends on the display unit; defaults to true. */
  cycles?: boolean | undefined;
  alignSelf?: "center" | "flex-start";
  testID?: string | undefined;
  "aria-label"?: string | undefined;
}

/** An amount a tap switches to the next enabled display unit, like the wallet balance; a plain frame with one unit only. */
export function UnitCyclePressable({
  children,
  cycles = true,
  alignSelf = "center",
  ...rest
}: UnitCyclePressableProps) {
  const frame = { ...rest, alignSelf, maxWidth: "100%" } as const;
  const { t } = useTranslation();
  const { allowedDisplayCurrencies, cycleDisplayCurrency } =
    useDisplayCurrencyCycle();
  if (!cycles || allowedDisplayCurrencies.length <= 1) {
    return <Stack {...frame}>{children}</Stack>;
  }
  return (
    <Pressable
      {...frame}
      tooltip={t("unitCycleAction")}
      onPress={cycleDisplayCurrency}
    >
      {children}
    </Pressable>
  );
}
