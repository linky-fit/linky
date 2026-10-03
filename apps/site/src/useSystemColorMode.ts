import type { ColorMode } from "@linky-fit/ui/tokens";
import { useSyncExternalStore } from "react";

const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

const subscribe = (onChange: () => void) => {
  const query = lightQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const getColorMode = (): ColorMode => (lightQuery().matches ? "light" : "dark");

export const useSystemColorMode = (): ColorMode =>
  useSyncExternalStore(subscribe, getColorMode);
