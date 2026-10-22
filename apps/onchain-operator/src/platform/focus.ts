/** Calls `listener` whenever the window gets the focus back; returns the unsubscribe. */
export const onFocus = (listener: () => void): (() => void) => {
  window.addEventListener("focus", listener);
  return () => window.removeEventListener("focus", listener);
};
