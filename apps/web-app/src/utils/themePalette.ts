import {
  supporterTierIncludes,
  type SupporterTier,
} from "@linky-fit/supporter";
import {
  palettes,
  THEME_PALETTES,
  type ColorMode,
  type ThemePalette,
} from "@linky-fit/ui/tokens";
import { safeLocalStorageGet, safeLocalStorageSet } from "./storage";

// index.html reads the same key to paint the boot screen before the bundle loads.
const THEME_STORAGE_KEY = "linky.theme";

/** The supporter tier that unlocks `palette`; null for the free Default. */
export const paletteUnlockTier = (
  palette: ThemePalette,
): SupporterTier | null => (palette === "default" ? null : palette);

export const isPaletteUnlocked = (
  palette: ThemePalette,
  unlockedTier: SupporterTier | null,
): boolean => {
  const required = paletteUnlockTier(palette);
  return (
    required === null ||
    (unlockedTier !== null && supporterTierIncludes(unlockedTier, required))
  );
};

const readStoredPreference = (): ThemePalette =>
  THEME_PALETTES.find(
    (palette) => palette === safeLocalStorageGet(THEME_STORAGE_KEY),
  ) ?? "default";

let preference = readStoredPreference();
// Undefined until the own awards are read, so a supporter's launch never flashes Default.
let unlockedTier: SupporterTier | null | undefined;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

export const getThemePalettePreference = (): ThemePalette => preference;

export const setThemePalettePreference = (next: ThemePalette): void => {
  if (next === preference) return;
  preference = next;
  safeLocalStorageSet(THEME_STORAGE_KEY, next);
  notify();
};

export const getUnlockedSupporterTier = (): SupporterTier | null =>
  unlockedTier ?? null;

export const setUnlockedSupporterTier = (tier: SupporterTier | null): void => {
  if (tier === unlockedTier) return;
  unlockedTier = tier;
  notify();
};

/** The palette to render: the preference while unlocked, else Default. */
export const getThemePalette = (): ThemePalette =>
  unlockedTier === undefined || isPaletteUnlocked(preference, unlockedTier)
    ? preference
    : "default";

export const subscribeThemePalette = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Syncs the CSS painted outside React (index.css, browser chrome) with the rendered theme. */
export const applyAppearanceToDocument = (
  mode: ColorMode,
  palette: ThemePalette,
): void => {
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.dataset.theme = palette;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", palettes[palette][mode].background);
};
