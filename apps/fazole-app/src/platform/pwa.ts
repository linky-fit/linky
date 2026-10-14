import { registerSW } from "virtual:pwa-register";

/** Registers the service worker that precaches the app, so the terminal opens offline. */
export const registerPwa = (): void => {
  void registerSW({ immediate: true });
};
