import type { SupporterTier } from "@linky-fit/supporter";
import type { ThemePalette } from "@linky-fit/ui/tokens";
import React from "react";
import {
  getThemePalette,
  getThemePalettePreference,
  getUnlockedSupporterTier,
  subscribeThemePalette,
} from "../utils/themePalette";

/** The palette to render, Default while the preferred one is locked. */
export const useThemePalette = (): ThemePalette =>
  React.useSyncExternalStore(
    subscribeThemePalette,
    getThemePalette,
    getThemePalette,
  );

export const useThemePalettePreference = (): ThemePalette =>
  React.useSyncExternalStore(
    subscribeThemePalette,
    getThemePalettePreference,
    getThemePalettePreference,
  );

export const useUnlockedSupporterTier = (): SupporterTier | null =>
  React.useSyncExternalStore(
    subscribeThemePalette,
    getUnlockedSupporterTier,
    getUnlockedSupporterTier,
  );
