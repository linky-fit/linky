import type { GetProps } from "tamagui";
import { Stack } from "./layout";

export type SafeAreaPadProps = GetProps<typeof Stack> & {
  /** The screen edge whose device inset pads this stack; none pads nothing. */
  edge?: "top" | "bottom" | undefined;
};

/** A stack padded by the device inset of a screen edge: the web app's stylesheet pads `data-safe-area`. */
export function SafeAreaPad({ edge, ...props }: SafeAreaPadProps) {
  return <Stack {...props} data-safe-area={edge} />;
}
