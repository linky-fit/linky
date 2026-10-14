import type { ReactNode } from "react";
import { TamaguiProvider } from "tamagui";
import { config } from "./config";
import type { ColorMode } from "./tokens";

export type UIProviderProps = { children: ReactNode } & (
  | { mode: ColorMode; brand?: "linky" | undefined }
  | { mode: "dark"; brand: "fazole" }
);

export function UIProvider({ mode, brand, children }: UIProviderProps) {
  return (
    <TamaguiProvider
      config={config}
      defaultTheme={brand === "fazole" ? "dark_fazole" : mode}
    >
      {children}
    </TamaguiProvider>
  );
}
