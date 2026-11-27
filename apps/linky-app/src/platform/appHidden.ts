/** Calls `listener` whenever the app goes to the background, where the OS may suspend its timers; returns the unsubscribe. */
export const subscribeAppHidden = (listener: () => void): (() => void) => {
  const onChange = () => {
    if (document.visibilityState === "hidden") listener();
  };
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
