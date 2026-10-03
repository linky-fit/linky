import { UIProvider } from "@linky-fit/ui";
import React from "react";
import AppShell from "./app/AppShell";
import { useColorMode } from "./hooks/useColorMode";
import { useThemePalette } from "./hooks/useThemePalette";
import { applyAppearanceToDocument } from "./utils/themePalette";

export default function App() {
  const mode = useColorMode();
  const palette = useThemePalette();
  React.useEffect(
    () => applyAppearanceToDocument(mode, palette),
    [mode, palette],
  );

  return (
    <UIProvider mode={mode} palette={palette}>
      <AppShell />
    </UIProvider>
  );
}
