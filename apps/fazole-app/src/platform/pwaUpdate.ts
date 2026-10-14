type Listener = (needRefresh: boolean) => void;
type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

const RELOAD_FALLBACK_MS = 1_500;

const listeners = new Set<Listener>();
const heldWork = new Set<Promise<void>>();
let needRefresh = false;
let applying = false;
let updateServiceWorker: UpdateServiceWorker | null = null;

export const recordRegistered = (update: UpdateServiceWorker) => {
  updateServiceWorker = update;
};

export const markNeedRefresh = (value: boolean) => {
  if ((value && applying) || needRefresh === value) return;
  needRefresh = value;
  for (const listener of listeners) listener(value);
};

export const recordControllerChange = () => markNeedRefresh(false);

export const subscribeNeedRefresh = (listener: Listener) => {
  listeners.add(listener);
  listener(needRefresh);
  return () => {
    listeners.delete(listener);
  };
};

export const isApplyingUpdate = () => applying;

/** Holds the update's reload back until `work` settles, so it cannot cut a wallet operation short. */
export const deferUpdateWhile = <A>(work: Promise<A>): Promise<A> => {
  const settled: Promise<void> = work.then(
    () => void heldWork.delete(settled),
    () => void heldWork.delete(settled),
  );
  heldWork.add(settled);
  return work;
};

/** Resolves once no wallet work holds the update back, including work started meanwhile. */
export const heldWorkSettled = async () => {
  while (heldWork.size > 0) await Promise.allSettled(heldWork);
};

/** Activates the waiting worker once wallet work settles; the page reloads when it takes control. */
export const applyUpdate = async () => {
  if (applying) return;
  applying = true;
  markNeedRefresh(false);
  await heldWorkSettled();
  if (!updateServiceWorker) {
    location.reload();
    return;
  }
  try {
    await updateServiceWorker(true);
    setTimeout(() => location.reload(), RELOAD_FALLBACK_MS);
  } catch (error) {
    console.warn("[fazole] service worker update failed", error);
    applying = false;
    markNeedRefresh(true);
  }
};
