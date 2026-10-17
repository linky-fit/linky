import type { ColorMode } from "@linky-fit/ui/tokens";
import { Appearance } from "react-native";
import { setNativeStatusBarColorMode } from "./nativeBridge";

/** Whether the system asks for a light appearance. */
export const systemPrefersLight = (): boolean =>
  Appearance.getColorScheme() === "light";

export const onSystemColorSchemeChange = (
  listener: () => void,
): (() => void) => {
  const subscription = Appearance.addChangeListener(listener);
  return () => subscription.remove();
};

/** Paints the status bar in `mode`. */
export const paintColorModeOutsideApp = (mode: ColorMode): void =>
  setNativeStatusBarColorMode(mode);
