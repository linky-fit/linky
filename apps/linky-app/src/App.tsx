import { UIProvider } from "@linky-fit/ui";
import React from "react";
import AppShell from "./app/AppShell";
import { useColorMode } from "./hooks/useColorMode";
import { applyColorModeToDocument } from "./utils/colorMode";

export default function App() {
  const mode = useColorMode();
  React.useEffect(() => applyColorModeToDocument(mode), [mode]);

  return (
    <UIProvider mode={mode}>
      <AppShell />
    </UIProvider>
  );
}
