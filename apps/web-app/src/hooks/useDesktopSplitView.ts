import React from "react";

const DESKTOP_SPLIT_VIEW_QUERY = "(min-width: 961px)";

const subscribe = (onStoreChange: () => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mediaQuery = window.matchMedia(DESKTOP_SPLIT_VIEW_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

const getSnapshot = (): boolean =>
  typeof window !== "undefined" && Boolean(window.matchMedia)
    ? window.matchMedia(DESKTOP_SPLIT_VIEW_QUERY).matches
    : false;

export const useDesktopSplitView = (): boolean =>
  React.useSyncExternalStore(subscribe, getSnapshot, () => false);
