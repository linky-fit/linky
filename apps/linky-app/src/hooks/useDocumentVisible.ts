import React from "react";

const subscribe = (onChange: () => void): (() => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

const getSnapshot = (): boolean => document.visibilityState === "visible";

export const useDocumentVisible = (): boolean =>
  React.useSyncExternalStore(subscribe, getSnapshot, () => true);
