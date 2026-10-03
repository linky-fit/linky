import type { ReactNode } from "react";
import { TamaguiProvider } from "tamagui";
import { config, themeName } from "./config";
import type { ColorMode, ThemePalette } from "./tokens";

export interface UIProviderProps {
  mode: ColorMode;
  palette?: ThemePalette | undefined;
  children: ReactNode;
}

export function UIProvider({
  mode,
  palette = "default",
  children,
}: UIProviderProps) {
  return (
    <TamaguiProvider config={config} defaultTheme={themeName(palette, mode)}>
      {children}
    </TamaguiProvider>
  );
}
