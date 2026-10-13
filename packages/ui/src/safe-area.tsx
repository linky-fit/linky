import type { GetProps } from "tamagui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "./layout";

export type SafeAreaPadProps = GetProps<typeof Stack> & {
  /** The screen edge whose device inset pads this stack; none pads nothing. */
  edge?: "top" | "bottom" | undefined;
};

// React Native lays out no sticky or fixed boxes; the nearest it has.
const nativePosition = (position: NonNullable<SafeAreaPadProps["position"]>) =>
  position === "fixed"
    ? "absolute"
    : position === "sticky"
      ? "relative"
      : position;

/** A stack padded by the device inset (notch, home indicator) of a screen edge. */
export function SafeAreaPad({ edge, position, ...props }: SafeAreaPadProps) {
  const insets = useSafeAreaInsets();
  const positioned: GetProps<typeof Stack> =
    position === undefined
      ? props
      : { ...props, position: nativePosition(position) };
  if (edge === "top") return <Stack {...positioned} paddingTop={insets.top} />;
  if (edge === "bottom")
    return <Stack {...positioned} paddingBottom={insets.bottom} />;
  return <Stack {...positioned} />;
}
