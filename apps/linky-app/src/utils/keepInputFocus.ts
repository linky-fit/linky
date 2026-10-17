import type React from "react";

/**
 * Keeps the focused input focused, and the mobile keyboard open, while a
 * control beside it is pressed. React Native's pointer events have no
 * preventDefault.
 */
export const keepInputFocus = (event: React.PointerEvent): void => {
  if (typeof event.preventDefault === "function") event.preventDefault();
};
