import type { ReactNode } from "react";
import { TamaguiProvider } from "tamagui";
import { config } from "./config";
import type { ColorMode } from "./tokens";

export interface UIProviderProps {
  children: ReactNode;
  mode?: ColorMode;
}

export function UIProvider({ children, mode = "dark" }: UIProviderProps) {
  return (
    <TamaguiProvider config={config} defaultTheme={mode}>
      {children}
    </TamaguiProvider>
  );
}
