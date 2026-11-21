import { isDevBuild } from "../platform/buildEnv";
import { sleep } from "./time";

type Listener = (needRefresh: boolean) => void;

const STARTUP_AUTO_UPDATE_WINDOW_MS = 5_000;
const CLIENT_COUNT_TIMEOUT_MS = 1_000;
const WORKER_PROBE_INTERVAL_MS = 5_000;
const WORKER_PROBE_TIMEOUT_MS = 10_000;

const listeners = new Set<Listener>();
const walletWork = new Set<Promise<void>>();
let needRefresh = false;
let applyingUpdate = false;
let reloadingAfterWalletWork = false;
let reloadingWhileWorkerAlive = false;
let reloadRequested = false;
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
  if (reloadRequested) return;
  reloadRequested = true;
  if (typeof location !== "undefined") {
    location.reload();
  }
};

const scheduleReloadFallback = () => {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    if (applyingUpdate) reloadAfterWalletWork();
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

const waitForWalletWork = async (): Promise<void> => {
  while (walletWork.size > 0) await Promise.allSettled(walletWork);
};

/** Holds the update's reload back until `work` settles, so it cannot cut a wallet operation short. */
export const deferPwaUpdateWhile = (work: Promise<void>): void => {
  walletWork.add(work);
  const release = () => {
    walletWork.delete(work);
  };
  void work.then(release, release);
};

/** Waits for all in-flight wallet operations to settle before reloading the page. */
export const reloadAfterWalletWork = (): void => {
  if (reloadingAfterWalletWork) return;
  reloadingAfterWalletWork = true;
  void waitForWalletWork().then(reloadPage);
};

/**
 * Reloads once all in-flight wallet operations finish, polling `isWorkerAlive`
 * while wallet work stays pending. A live database worker (e.g. a waiting newer
 * build, even repeated) keeps the wait open until every payment settles; a dead,
 * throwing, or bfcache-disposed worker breaks out and reloads once the probe fails.
 */
export const reloadAfterWalletWorkWhileWorkerAlive = (
  isWorkerAlive: (timeoutMs: number) => Promise<boolean>,
): void => {
  if (reloadingWhileWorkerAlive) return;
  reloadingWhileWorkerAlive = true;
  const checkAlive = async (): Promise<boolean> => {
    try {
      return await isWorkerAlive(WORKER_PROBE_TIMEOUT_MS);
    } catch {
      return false;
    }
  };
  void (async () => {
    try {
      while (walletWork.size > 0) {
        const outcome = await Promise.race([
          waitForWalletWork().then(() => "drained" as const),
          checkAlive().then((alive) =>
            alive ? ("alive" as const) : ("dead" as const),
          ),
        ]);
        if (outcome !== "alive") break;
        const drained = await Promise.race([
          waitForWalletWork().then(() => true),
          sleep(WORKER_PROBE_INTERVAL_MS).then(() => false),
        ]);
        if (drained) break;
      }
    } finally {
      reloadPage();
    }
  })();
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
  if (isDevBuild) {
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
  await waitForWalletWork();
  if (!updateSW) {
    reloadAfterWalletWork();
    return;
  }
  try {
    await updateSW(true);
    scheduleReloadFallback();
  } catch (error) {
    applyingUpdate = false;
    markPwaNeedRefresh(true);
    console.warn("[linky][pwa] updateSW failed", error);
    reloadAfterWalletWork();
  }
};
