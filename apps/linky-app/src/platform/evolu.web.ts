import { createConsole, createQueryBuilder, kyselySql } from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import {
  LinkyEvoluSchema,
  type EvoluRun,
  type LinkyEvolu,
} from "@linky-fit/linksync/evolu";
import { reloadAfterWalletWorkWhileWorkerAlive } from "../utils/pwaUpdate";
import { safeLocalStorageGet } from "../utils/storage";
import { sleep } from "../utils/time";
import { isDevBuild } from "./buildEnv";

// SQL logging is very noisy, so dev builds log only on request:
// localStorage.setItem('linky_debug_evolu_sql', '1')
const isEvoluLoggingEnabled = (): boolean =>
  isDevBuild && safeLocalStorageGet("linky_debug_evolu_sql") === "1";

// Sentinel query that always returns one row on a live SQLite worker, whereas
// a disposed Evolu instance resolves pending uncached queries with `[]`.
const livenessQuery = createQueryBuilder(LinkyEvoluSchema)((db) =>
  db
    .selectFrom(
      kyselySql<{ readonly alive: number }>`(select 1 as alive)`.as("probe"),
    )
    .selectAll(),
);

export type EvoluWorkerProbe = (timeoutMs: number) => Promise<boolean>;

interface WorkerProbeSlot {
  readonly setProbe: (probe: EvoluWorkerProbe) => void;
  readonly isDisposed: () => boolean;
}

const workerProbesByRun = new WeakMap<EvoluRun, WorkerProbeSlot>();

/** Registers the opened database so Evolu's `reloadApp` can probe whether its worker is still alive. */
export const registerEvoluWorkerProbe = (
  run: EvoluRun,
  evolu: Pick<LinkyEvolu, "loadQuery">,
): void => {
  const slot = workerProbesByRun.get(run);
  if (!slot) return;
  slot.setProbe((timeoutMs) => {
    if (slot.isDisposed()) return Promise.resolve(false);
    try {
      return Promise.race([
        evolu.loadQuery(livenessQuery, { cache: false }).then(
          (rows) => !slot.isDisposed() && rows.length > 0,
          () => false,
        ),
        sleep(timeoutMs).then(() => false),
      ]);
    } catch {
      return Promise.resolve(false);
    }
  });
};

/**
 * Routes Evolu's `reloadApp` callback through a live-worker probe: while the
 * worker answers (e.g. a waiting newer build, even repeated), in-flight wallet
 * operations run to completion; if the worker is dead or the page entered
 * bfcache, the reload is bounded.
 */
export const createEvoluReloadHandler = ({
  onReload = reloadAfterWalletWorkWhileWorkerAlive,
}: {
  readonly onReload?: (isWorkerAlive: EvoluWorkerProbe) => void;
} = {}) => {
  let bfcacheDisposed = false;
  let probeWorker: EvoluWorkerProbe | null = null;
  const onPageHide = (event: { readonly persisted: boolean }) => {
    if (event.persisted) bfcacheDisposed = true;
  };
  const isWorkerAlive: EvoluWorkerProbe = (timeoutMs) => {
    if (bfcacheDisposed || probeWorker === null) return Promise.resolve(false);
    return probeWorker(timeoutMs);
  };
  return {
    onPageHide,
    setWorkerProbe: (probe: EvoluWorkerProbe) => {
      probeWorker = probe;
    },
    reloadApp: () => {
      onReload(isWorkerAlive);
    },
  };
};

/** The page's one Evolu run; creating it starts Evolu's shared worker. */
export const createEvoluRun = () => {
  let disposed = false;
  const reloadHandler = createEvoluReloadHandler();
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", reloadHandler.onPageHide);
  }
  const deps = createEvoluDeps({
    reloadApp: reloadHandler.reloadApp,
    ...(isEvoluLoggingEnabled()
      ? { console: createConsole({ level: "debug" }) }
      : {}),
  });
  const run = createRun(deps);
  workerProbesByRun.set(run, {
    setProbe: reloadHandler.setWorkerProbe,
    isDisposed: () => disposed,
  });
  run.defer(() => {
    disposed = true;
    workerProbesByRun.delete(run);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", reloadHandler.onPageHide);
    }
    deps[Symbol.dispose]();
  });
  return run;
};
