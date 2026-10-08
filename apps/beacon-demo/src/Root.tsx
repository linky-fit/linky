import { UIProvider } from "@linky-fit/ui";
import { themes, type ColorMode } from "@linky-fit/ui/tokens";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { App } from "./App";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const subscribe = (listener: () => void) => {
  darkQuery.addEventListener("change", listener);
  return () => darkQuery.removeEventListener("change", listener);
};

const colorMode = (): ColorMode => (darkQuery.matches ? "dark" : "light");

export function Root() {
  const mode = useSyncExternalStore(subscribe, colorMode);
  useLayoutEffect(() => {
    const { background, color } = themes[mode];
    document.documentElement.style.colorScheme = mode;
    document.documentElement.style.backgroundColor = background;
    document.documentElement.style.color = color;
  }, [mode]);
  return (
    <UIProvider mode={mode}>
      <App />
    </UIProvider>
  );
}
