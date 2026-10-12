import { Workbox } from "workbox-window";
import { devServiceWorkerUrl, isDevBuild } from "./buildEnv";

// The build bundles the worker into one classic script. A changed URL or type
// counts as an update, so production keeps what existing installs registered.
const SW_URL = isDevBuild ? devServiceWorkerUrl : "/sw.js";
const SW_TYPE = isDevBuild ? "module" : "classic";

interface RegisterServiceWorkerOptions {
  readonly onNeedRefresh: () => void;
  readonly onOfflineReady: () => void;
  readonly onRegistered: (
    swUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
  readonly onRegisterError: (error: unknown) => void;
}

/**
 * Registers the service worker in prompt mode: a waiting update calls
 * `onNeedRefresh`, and the returned function activates it. The page reloads
 * once the new worker takes control.
 */
export const registerServiceWorker = ({
  onNeedRefresh,
  onOfflineReady,
  onRegistered,
  onRegisterError,
}: RegisterServiceWorkerOptions): (() => Promise<void>) => {
  if (!("serviceWorker" in navigator) || SW_URL === null)
    return () => Promise.resolve();

  const workbox = new Workbox(SW_URL, { scope: "/", type: SW_TYPE });
  let updatePrompted = false;
  const promptUpdate = () => {
    if (!updatePrompted) {
      updatePrompted = true;
      workbox.addEventListener("controlling", (event) => {
        if (event.isUpdate) window.location.reload();
      });
    }
    onNeedRefresh();
  };
  workbox.addEventListener("waiting", promptUpdate);
  workbox.addEventListener("installed", (event) => {
    // A worker installed by another tab reports isExternal instead of isUpdate.
    if (event.isUpdate === undefined && event.isExternal) promptUpdate();
    else if (!event.isUpdate && !updatePrompted) onOfflineReady();
  });

  const registered = workbox
    .register({ immediate: true })
    .then(
      (registration) => onRegistered(SW_URL, registration),
      onRegisterError,
    );
  return async () => {
    await registered;
    workbox.messageSkipWaiting();
  };
};
