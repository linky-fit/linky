import type { ColorMode } from "@linky-fit/ui/tokens";
import { useSyncExternalStore } from "react";

export type ColorModePreference = ColorMode | "auto";

export const colorModePreferences: readonly ColorModePreference[] = [
  "auto",
  "light",
  "dark",
];

// Shared with the web app; the boot script in vite.config.ts reads it before first paint.
const storageKey = "linky.color_mode";

const readStoredPreference = (): ColorModePreference => {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "auto";
};

let preference = readStoredPreference();
const listeners = new Set<() => void>();
const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

const subscribe = (listener: () => void) => {
  const query = lightQuery();
  listeners.add(listener);
  query.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", listener);
  };
};

const getPreference = () => preference;

const getColorMode = (): ColorMode =>
  preference === "auto"
    ? lightQuery().matches
      ? "light"
      : "dark"
    : preference;

export const setColorModePreference = (next: ColorModePreference) => {
  preference = next;
  if (next === "auto") window.localStorage.removeItem(storageKey);
  else window.localStorage.setItem(storageKey, next);
  for (const listener of listeners) listener();
};

export const useColorMode = (): ColorMode =>
  useSyncExternalStore(subscribe, getColorMode);

export const useColorModePreference = (): ColorModePreference =>
  useSyncExternalStore(subscribe, getPreference);
