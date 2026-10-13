export const subscribeScreenOrientation = (
  onChange: () => void,
): (() => void) => {
  window.screen.orientation?.addEventListener("change", onChange);
  return () =>
    window.screen.orientation?.removeEventListener("change", onChange);
};

/** Whether the OS turned the whole screen upside down. */
export const isScreenUpsideDown = (): boolean =>
  window.screen.orientation?.angle === 180;
