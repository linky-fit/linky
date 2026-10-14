// React's act() only works when the test environment opts in.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// jsdom has no matchMedia, and Tamagui reads it at module load.
window.matchMedia = (media: string): MediaQueryList => ({
  matches: false,
  media,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
