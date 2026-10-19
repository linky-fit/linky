import type { ColorMode } from "@linky-fit/ui/tokens";
import type { I18nKey } from "../i18n";
import {
  onSystemColorSchemeChange,
  paintColorModeOutsideApp,
  systemPrefersLight,
} from "../platform/systemColorScheme";
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

// index.html reads the same key to paint the boot screen before the bundle loads.
const COLOR_MODE_STORAGE_KEY = "linky.color_mode";

const readStoredPreference = (): ColorModePreference => {
  const stored = safeLocalStorageGet(COLOR_MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "auto";
};

let preference = readStoredPreference();
const listeners = new Set<() => void>();

export const getColorModePreference = (): ColorModePreference => preference;

export const setColorModePreference = (next: ColorModePreference): void => {
  if (next === preference) return;
  preference = next;
  safeLocalStorageSet(COLOR_MODE_STORAGE_KEY, next);
  for (const listener of listeners) listener();
};

export const getColorMode = (): ColorMode => {
  if (preference !== "auto") return preference;
  return systemPrefersLight() ? "light" : "dark";
};

export const subscribeColorMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const unsubscribeSystem = onSystemColorSchemeChange(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeSystem();
  };
};

/** Syncs what is painted outside React (index.css, browser chrome, native status bar) with `mode`. */
export const applyColorModeToDocument = (mode: ColorMode): void =>
  paintColorModeOutsideApp(mode);
