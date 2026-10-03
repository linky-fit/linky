import { UIProvider } from "@linky-fit/ui";
import { themes, type ColorMode } from "@linky-fit/ui/tokens";
import "@linky-fit/ui/manrope.css";
import { useLayoutEffect, type ReactNode } from "react";
import "./reset.css";
import { useSystemColorMode } from "./useSystemColorMode";

const applyColorModeToDocument = (mode: ColorMode) => {
  const { background, color } = themes[mode];
  const root = document.documentElement;
  root.style.colorScheme = mode;
  root.style.backgroundColor = background;
  root.style.color = color;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background);
};

export function SiteRoot({ children }: { children: ReactNode }) {
  const mode = useSystemColorMode();
  useLayoutEffect(() => applyColorModeToDocument(mode), [mode]);
  return <UIProvider mode={mode}>{children}</UIProvider>;
}
