// Works around an iOS standalone-PWA WebKit bug: opening the software
// keyboard permanently shrinks the layout viewport by the top safe-area
// inset (window.innerHeight, 100dvh and visualViewport.height all stay
// ~60px short after the keyboard closes, until the app is force-quit).
// Toggling display on the app root forces WebKit to re-measure the
// viewport. See
// https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d
export const installIosViewportHeal = (): void => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const nav: Navigator & { standalone?: boolean } = navigator;
  if (nav.standalone !== true) return;

  const portraitQuery = window.matchMedia("(orientation: portrait)");
  const currentOrientation = (): "portrait" | "landscape" =>
    portraitQuery.matches ? "portrait" : "landscape";

  // iOS keeps screen.width/height portrait-fixed, so take max/min instead of
  // trusting which of the two is "height" in the current orientation.
  const fullScreenHeight = (orientation: "portrait" | "landscape") =>
    orientation === "portrait"
      ? Math.max(window.screen.width, window.screen.height)
      : Math.min(window.screen.width, window.screen.height);

  const editableFocused = () => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA")
    );
  };

  // Baselines are per orientation and only learned while no editable element
  // is focused, so keyboard-occluded heights never become the reference and
  // rotating mid-typing cannot destroy a known-good baseline.
  const maxInnerHeightByOrientation = { portrait: 0, landscape: 0 };

  const recordBaseline = () => {
    if (editableFocused()) return;
    const orientation = currentOrientation();
    maxInnerHeightByOrientation[orientation] = Math.max(
      maxInnerHeightByOrientation[orientation],
      Math.min(window.innerHeight, fullScreenHeight(orientation)),
    );
  };

  recordBaseline();
  window.addEventListener("resize", recordBaseline);

  const heal = () => {
    if (editableFocused()) return;
    recordBaseline();
    const baseline = maxInnerHeightByOrientation[currentOrientation()];
    if (baseline - window.innerHeight <= 4) return;
    const rootEl = document.getElementById("root");
    if (!rootEl) return;
    const previousDisplay = rootEl.style.display;
    rootEl.style.display = "none";
    void rootEl.offsetHeight;
    rootEl.style.display = previousDisplay;
  };

  document.addEventListener("focusout", () => {
    window.setTimeout(heal, 150);
  });
};
