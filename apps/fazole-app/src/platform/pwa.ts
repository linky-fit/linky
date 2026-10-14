import { registerSW } from "virtual:pwa-register";
import {
  heldWorkSettled,
  isApplyingUpdate,
  markNeedRefresh,
  recordControllerChange,
  recordRegistered,
} from "./pwaUpdate";

const UPDATE_CHECK_INTERVAL_MS = 30_000;

/** Looks for a new release periodically and whenever the terminal comes back to the foreground. */
const watchForUpdates = (registration: ServiceWorkerRegistration) => {
  const check = () => {
    if (!navigator.onLine) return;
    registration.update().catch((error: unknown) => {
      console.warn("[fazole] service worker update check failed", error);
    });
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
};

/** Registers the service worker that precaches the app, so the terminal opens offline, and offers each new release. */
export const registerPwa = (): void => {
  recordRegistered(
    registerSW({
      immediate: true,
      onNeedRefresh: () => markNeedRefresh(true),
      onRegisteredSW: (_url, registration) => {
        if (registration) watchForUpdates(registration);
      },
    }),
  );
  if (!("serviceWorker" in navigator)) return;
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    recordControllerChange();
    // Another tab accepted the update; this one would keep loading old assets missing from the new precache.
    if (hadController && !isApplyingUpdate()) {
      void heldWorkSettled().then(() => location.reload());
    }
  });
};
