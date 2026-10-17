type Unsubscribe = () => void;

/** False only while the device reports no network connection. */
export const isOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** Calls `callback` whenever the device regains a network connection. */
export const onOnline = (callback: () => void): Unsubscribe => {
  window.addEventListener("online", callback);
  return () => window.removeEventListener("online", callback);
};

/** Calls `callback` with the new state whenever the network connection comes or goes. */
export const onConnectivityChange = (
  callback: (online: boolean) => void,
): Unsubscribe => {
  const listener = (event: Event) => callback(event.type === "online");
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

/** Whether the app is in the foreground. */
export const isAppVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState === "visible";

/** Calls `callback` whenever the app moves to the foreground or the background. */
export const onVisibilityChange = (callback: () => void): Unsubscribe => {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
};

/** Calls `callback` whenever the app returns to the foreground. */
export const onAppResume = (callback: () => void): Unsubscribe =>
  onVisibilityChange(() => {
    if (isAppVisible()) callback();
  });

const NATIVE_BACK_BUTTON_EVENT = "linky-native-back-button";

/**
 * Offers the system back press to `handler`, which returns true when it
 * handled the press. An unhandled press runs the default, closing the app.
 * The Android shell dispatches the press as a cancelable window event.
 */
export const onBackPress = (handler: () => boolean): Unsubscribe => {
  const listener = (event: Event) => {
    if (handler()) event.preventDefault();
  };
  window.addEventListener(NATIVE_BACK_BUTTON_EVENT, listener);
  return () => window.removeEventListener(NATIVE_BACK_BUTTON_EVENT, listener);
};

/** Boot progress the page shell (index.html) listens for. */
export type AppEvent =
  | "linky-app-mounted"
  | "linky-boot-decision-pending"
  | "linky-boot-decision-resolved"
  | "linky-boot-failed"
  | "linky-clear-cache-and-reload";

export const emitAppEvent = (event: AppEvent): void => {
  window.dispatchEvent(new Event(event));
};
