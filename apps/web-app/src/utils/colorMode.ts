import { themes, type ColorMode } from "@linky-fit/ui/tokens";
import type { I18nKey } from "../i18n";
import { safeLocalStorageGet, safeLocalStorageSet } from "./storage";

export type ColorModePreference = ColorMode | "auto";

export const COLOR_MODE_PREFERENCES: ReadonlyArray<ColorModePreference> = [
  "auto",
  "light",
  "dark",
];

export const COLOR_MODE_PREFERENCE_LABEL_KEYS: Record<
  ColorModePreference,
  I18nKey
> = {
  auto: "appearanceAuto",
  light: "appearanceLight",
  dark: "appearanceDark",
};

// index.html reads the same key and query to paint the boot screen before the bundle loads.
const COLOR_MODE_STORAGE_KEY = "linky.color_mode";
const SYSTEM_LIGHT_QUERY = "(prefers-color-scheme: light)";

const readStoredPreference = (): ColorModePreference => {
  const stored = safeLocalStorageGet(COLOR_MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "auto";
};

let preference = readStoredPreference();
const listeners = new Set<() => void>();

const systemQuery = (): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia(SYSTEM_LIGHT_QUERY) : null;

export const getColorModePreference = (): ColorModePreference => preference;

export const setColorModePreference = (next: ColorModePreference): void => {
  if (next === preference) return;
  preference = next;
  safeLocalStorageSet(COLOR_MODE_STORAGE_KEY, next);
  for (const listener of listeners) listener();
};

export const getColorMode = (): ColorMode => {
  if (preference !== "auto") return preference;
  return systemQuery()?.matches ? "light" : "dark";
};

export const subscribeColorMode = (listener: () => void): (() => void) => {
  const query = systemQuery();
  listeners.add(listener);
  query?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener("change", listener);
  };
};

/** Syncs the CSS painted outside React (index.css, browser chrome) with `mode`. */
export const applyColorModeToDocument = (mode: ColorMode): void => {
  document.documentElement.dataset.colorMode = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themes[mode].background);
};
