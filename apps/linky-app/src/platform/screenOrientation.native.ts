// app.config.ts locks the app to portrait, which never turns upside down.

export const subscribeScreenOrientation: (onChange: () => void) => () => void =
  () => () => {};

export const isScreenUpsideDown = (): boolean => false;
