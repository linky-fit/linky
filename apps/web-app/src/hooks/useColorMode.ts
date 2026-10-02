import type { ColorMode } from "@linky-fit/ui/tokens";
import React from "react";
import {
  getColorMode,
  getColorModePreference,
  subscribeColorMode,
  type ColorModePreference,
} from "../utils/colorMode";

export const useColorMode = (): ColorMode =>
  React.useSyncExternalStore(subscribeColorMode, getColorMode, getColorMode);

export const useColorModePreference = (): ColorModePreference =>
  React.useSyncExternalStore(
    subscribeColorMode,
    getColorModePreference,
    getColorModePreference,
  );
