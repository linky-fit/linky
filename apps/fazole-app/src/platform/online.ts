/** Calls `listener` whenever the browser comes back online; returns the unsubscribe. */
export const onOnline = (listener: () => void): (() => void) => {
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
};
