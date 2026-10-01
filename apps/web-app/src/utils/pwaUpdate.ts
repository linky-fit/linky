type Listener = (needRefresh: boolean) => void;

const STARTUP_AUTO_UPDATE_WINDOW_MS = 5_000;
const CLIENT_COUNT_TIMEOUT_MS = 1_000;

const listeners = new Set<Listener>();
const walletWork = new Set<Promise<void>>();
let needRefresh = false;
let applyingUpdate = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

const appStartTime = Date.now();
let userHasInteracted = false;

if (typeof window !== "undefined") {
  for (const eventName of ["pointerdown", "keydown"]) {
    window.addEventListener(
      eventName,
      () => {
        userHasInteracted = true;
      },
      { capture: true, once: true },
    );
  }
}

const reloadPage = () => {
  if (typeof location !== "undefined") {
    location.reload();
  }
};

const scheduleReloadFallback = () => {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    if (applyingUpdate) reloadPage();
  }, 1_500);
};

export const recordPwaRegistered = (
  fn: ((reloadPage?: boolean) => Promise<void>) | null,
) => {
  updateSW = fn;
};

export const markPwaNeedRefresh = (value: boolean) => {
  if (value && applyingUpdate) return;
  if (needRefresh === value) return;
  needRefresh = value;
  for (const listener of listeners) {
    listener(value);
  }
};

export const recordPwaControllerChange = () => {
  markPwaNeedRefresh(false);
};

export const subscribePwaNeedRefresh = (listener: Listener) => {
  listeners.add(listener);
  listener(needRefresh);
  return () => {
    listeners.delete(listener);
  };
};

export const isApplyingPwaUpdate = () => applyingUpdate;

/** Holds the update's reload back until `work` settles, so it cannot cut a wallet operation short. */
export const deferPwaUpdateWhile = (work: Promise<void>): void => {
  walletWork.add(work);
  const release = () => {
    walletWork.delete(work);
  };
  void work.then(release, release);
};

const readClientCount = (data: unknown): number | null => {
  if (typeof data === "object" && data !== null && "count" in data) {
    const { count } = data;
    if (typeof count === "number") return count;
  }
  return null;
};

// Asks the controlling service worker how many window clients are open.
// Resolves null when there is no controller or the SW predates the
// CLIENT_COUNT handler (the reply then never arrives and the timeout fires).
const countSwClients = (): Promise<number | null> => {
  const controller =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller
      : null;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), CLIENT_COUNT_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      resolve(readClientCount(event.data));
    };
    controller.postMessage({ type: "CLIENT_COUNT" }, [channel.port2]);
  });
};

// Production: a fresh, untouched, single-tab load applies a pending
// service worker update silently (one reload before the user does anything);
// every other case falls back to the update banner. Auto-applying is skipped
// whenever other tabs are open because SKIP_WAITING reloads all of them.
export const handlePwaUpdateAvailable = async () => {
  if (import.meta.env.DEV) {
    await applyPwaUpdate();
    return;
  }
  const withinStartupWindow =
    Date.now() - appStartTime < STARTUP_AUTO_UPDATE_WINDOW_MS;
  if (!withinStartupWindow || userHasInteracted) {
    markPwaNeedRefresh(true);
    return;
  }
  const clientCount = await countSwClients();
  if (clientCount === 1 && !userHasInteracted) {
    console.log("[linky][pwa] auto-applying update on fresh load");
    await applyPwaUpdate();
    return;
  }
  markPwaNeedRefresh(true);
};

export const applyPwaUpdate = async () => {
  if (applyingUpdate) return;
  applyingUpdate = true;
  markPwaNeedRefresh(false);
  while (walletWork.size > 0) await Promise.allSettled(walletWork);
  if (!updateSW) {
    reloadPage();
    return;
  }
  try {
    await updateSW(true);
    scheduleReloadFallback();
  } catch (error) {
    applyingUpdate = false;
    markPwaNeedRefresh(true);
    console.warn("[linky][pwa] updateSW failed", error);
    reloadPage();
  }
};
