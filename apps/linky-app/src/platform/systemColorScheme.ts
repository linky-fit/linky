import { themes, type ColorMode } from "@linky-fit/ui/tokens";
import { setNativeStatusBarColorMode } from "./nativeBridge";

// index.html reads the same query to paint the boot screen before the bundle loads.
const SYSTEM_LIGHT_QUERY = "(prefers-color-scheme: light)";

const systemQuery = (): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia(SYSTEM_LIGHT_QUERY) : null;

/** Whether the system asks for a light appearance. */
export const systemPrefersLight = (): boolean =>
  systemQuery()?.matches ?? false;

export const onSystemColorSchemeChange = (
  listener: () => void,
): (() => void) => {
  const query = systemQuery();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
};

/** Paints what lies outside React (index.css, browser chrome, native status bar) in `mode`. */
export const paintColorModeOutsideApp = (mode: ColorMode): void => {
  document.documentElement.dataset.colorMode = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themes[mode].background);
  setNativeStatusBarColorMode(mode);
};
