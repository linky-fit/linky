// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPwaUpdate = async () => {
  vi.resetModules();
  return import("./pwaUpdate");
};

describe("pwaUpdate", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubEnv("DEV", false);
    vi.stubGlobal("location", { reload: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clears and suppresses the prompt until the accepted update reloads", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });

    pwaUpdate.markPwaNeedRefresh(true);
    pwaUpdate.recordPwaRegistered(() => Promise.resolve());

    await pwaUpdate.applyPwaUpdate();
    pwaUpdate.markPwaNeedRefresh(true);

    expect(values).toEqual([false, true, false]);

    pwaUpdate.recordPwaControllerChange();
    pwaUpdate.markPwaNeedRefresh(true);

    expect(values).toEqual([false, true, false]);
  });

  it("holds the update back until all deferred wallet work, including work queued meanwhile, settles", async () => {
    const pwaUpdate = await loadPwaUpdate();
    const updateSW = vi.fn(() => Promise.resolve());
    pwaUpdate.recordPwaRegistered(updateSW);
    let finishReceive = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishReceive = resolve;
      }),
    );

    const applied = pwaUpdate.applyPwaUpdate();
    await Promise.resolve();
    expect(updateSW).not.toHaveBeenCalled();

    let finishQueued = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishQueued = resolve;
      }),
    );
    finishReceive();
    await Promise.resolve();
    await Promise.resolve();
    expect(updateSW).not.toHaveBeenCalled();

    finishQueued();
    await applied;
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("waits past 5s for live wallet work in applyPwaUpdate and reloadAfterWalletWork", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    const updateSW = vi.fn(() => Promise.resolve());
    pwaUpdate.recordPwaRegistered(updateSW);
    let finishMelt = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishMelt = resolve;
      }),
    );

    const applied = pwaUpdate.applyPwaUpdate();
    pwaUpdate.reloadAfterWalletWork();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(updateSW).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();

    finishMelt();
    await applied;
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("waits past 15s while the database worker stays alive, even across repeated reload calls", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    let finishMelt = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishMelt = resolve;
      }),
    );

    const alive = vi.fn(() => Promise.resolve(true));
    pwaUpdate.reloadAfterWalletWorkWhileWorkerAlive(alive);
    pwaUpdate.reloadAfterWalletWorkWhileWorkerAlive(alive);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(location.reload).not.toHaveBeenCalled();

    finishMelt();
    await vi.advanceTimersByTimeAsync(0);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when a silent worker probe times out, even if an unbounded reload is already waiting", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    pwaUpdate.deferPwaUpdateWhile(new Promise<void>(() => {}));

    pwaUpdate.reloadAfterWalletWork();
    pwaUpdate.reloadAfterWalletWorkWhileWorkerAlive(
      (timeoutMs) =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), timeoutMs);
        }),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(location.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads if the worker probe throws synchronously or rejects", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    pwaUpdate.deferPwaUpdateWhile(new Promise<void>(() => {}));

    pwaUpdate.reloadAfterWalletWorkWhileWorkerAlive(() => {
      throw new Error("closed port");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once a live worker later goes silent mid-payment", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    pwaUpdate.deferPwaUpdateWhile(new Promise<void>(() => {}));

    let workerAlive = true;
    pwaUpdate.reloadAfterWalletWorkWhileWorkerAlive((timeoutMs) =>
      workerAlive
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), timeoutMs);
          }),
    );
    await vi.advanceTimersByTimeAsync(7_000);
    expect(location.reload).not.toHaveBeenCalled();

    workerAlive = false;
    await vi.advanceTimersByTimeAsync(13_000);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("acquires the shared wallet-work lock before resolving, releases on persisted pagehide, and rejects during a pending wipe", async () => {
    localStorage.clear();
    let lockHeld = false;
    let lockPromise: Promise<void> | null = null;
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(
          (
            _name: string,
            options: { readonly mode?: string },
            callback: () => Promise<void>,
          ) => {
            expect(options.mode).toBe("shared");
            lockHeld = true;
            lockPromise = Promise.resolve(callback()).finally(() => {
              lockHeld = false;
            });
            return lockPromise;
          },
        ),
      },
    });
    const pwaUpdate = await loadPwaUpdate();
    const release = await pwaUpdate.acquireWalletWorkGuard();
    expect(lockHeld).toBe(true);
    // Nested guard in the same tab reuses the shared lock without requesting a
    // second lock, even if a wipe starts meanwhile so in-flight work finishes.
    localStorage.setItem(
      "linky.evolu.wipePending.v1",
      JSON.stringify({ ownerId: "o", token: "t" }),
    );
    const releaseNested = await pwaUpdate.acquireWalletWorkGuard();
    localStorage.clear();
    expect(navigator.locks.request).toHaveBeenCalledTimes(1);
    release();
    expect(lockHeld).toBe(true);
    releaseNested();
    await lockPromise;
    expect(lockHeld).toBe(false);

    // Persisted pagehide releases the shared lock so bfcache cannot pin a boot wipe,
    // and releasing a stale pre-pagehide handle cannot release a newer lock.
    const staleHandle = await pwaUpdate.acquireWalletWorkGuard();
    expect(lockHeld).toBe(true);
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    await lockPromise;
    expect(lockHeld).toBe(false);

    const freshHandle = await pwaUpdate.acquireWalletWorkGuard();
    expect(lockHeld).toBe(true);
    staleHandle();
    expect(lockHeld).toBe(true);
    freshHandle();
    await lockPromise;
    expect(lockHeld).toBe(false);

    // Persisted pagehide while a lock request is still queued aborts the request
    // and rejects even if a late grant callback fires.
    let queuedSignal: AbortSignal | undefined;
    let runLateGrant: () => Promise<void> | void = () => {
      throw new Error("expected queued callback");
    };
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(
          (
            _name: string,
            options: { readonly mode?: string; readonly signal?: AbortSignal },
            callback: () => Promise<void> | void,
          ) => {
            queuedSignal = options.signal;
            runLateGrant = callback;
            return new Promise<void>(() => {});
          },
        ),
      },
    });
    const pendingGuard = pwaUpdate.acquireWalletWorkGuard();
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    expect(queuedSignal?.aborted).toBe(true);
    runLateGrant();
    await expect(pendingGuard).rejects.toThrow("back-forward cache");

    // Pending wipe rejects new wallet work before entering the operation body.
    localStorage.setItem(
      "linky.evolu.wipePending.v1",
      JSON.stringify({ ownerId: "o", token: "t" }),
    );
    await expect(pwaUpdate.acquireWalletWorkGuard()).rejects.toThrow(
      "Local database wipe is pending",
    );
    localStorage.clear();
  });

  it("defers the 1.5s applyPwaUpdate fallback reload when wallet work starts during activation", async () => {
    vi.useFakeTimers();
    const pwaUpdate = await loadPwaUpdate();
    pwaUpdate.recordPwaRegistered(() => Promise.resolve());

    await pwaUpdate.applyPwaUpdate();

    let finishPayment = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishPayment = resolve;
      }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(location.reload).not.toHaveBeenCalled();

    finishPayment();
    await vi.advanceTimersByTimeAsync(0);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("defers the catch-path reload if wallet work starts while updateSW rejects", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pwaUpdate = await loadPwaUpdate();
    let rejectUpdate: (error: Error) => void = () => undefined;
    pwaUpdate.recordPwaRegistered(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectUpdate = reject;
        }),
    );

    const applied = pwaUpdate.applyPwaUpdate();
    await Promise.resolve();

    let finishPayment = (): void => undefined;
    pwaUpdate.deferPwaUpdateWhile(
      new Promise<void>((resolve) => {
        finishPayment = resolve;
      }),
    );

    rejectUpdate(new Error("sw failed"));
    await applied;
    expect(warn).toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();

    finishPayment();
    await vi.advanceTimersByTimeAsync(0);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  const stubSwController = (clientCount: number) => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: {
          postMessage: (_message: unknown, transfer: Transferable[]) => {
            const port = transfer[0];
            if (port instanceof MessagePort) {
              port.postMessage({ count: clientCount });
            }
          },
        },
      },
    });
  };

  it("auto-applies a startup update when this tab is the only client", async () => {
    stubSwController(1);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });
    pwaUpdate.recordPwaRegistered(updateSW);

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).toHaveBeenCalledWith(true);
    expect(values).toEqual([false]);
  });

  it("shows the prompt instead of auto-applying when other tabs are open", async () => {
    stubSwController(2);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });
    pwaUpdate.recordPwaRegistered(updateSW);

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).not.toHaveBeenCalled();
    expect(values).toEqual([false, true]);
  });

  it("shows the prompt when the client count is unknown", async () => {
    vi.stubGlobal("navigator", {});
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });
    pwaUpdate.recordPwaRegistered(updateSW);

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).not.toHaveBeenCalled();
    expect(values).toEqual([false, true]);
  });

  it("shows the prompt once the user has interacted", async () => {
    stubSwController(1);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });
    pwaUpdate.recordPwaRegistered(updateSW);
    window.dispatchEvent(new Event("pointerdown"));

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).not.toHaveBeenCalled();
    expect(values).toEqual([false, true]);
  });

  it("shows the prompt after the startup window has passed", async () => {
    stubSwController(1);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });
    pwaUpdate.recordPwaRegistered(updateSW);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).not.toHaveBeenCalled();
    expect(values).toEqual([false, true]);
  });

  it("silently applies development updates after interaction with multiple tabs", async () => {
    vi.stubEnv("DEV", true);
    stubSwController(2);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];
    const updateSW = vi.fn(() => Promise.resolve());
    pwaUpdate.subscribePwaNeedRefresh((value) => values.push(value));
    pwaUpdate.recordPwaRegistered(updateSW);
    window.dispatchEvent(new Event("pointerdown"));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);

    await pwaUpdate.handlePwaUpdateAvailable();

    expect(updateSW).toHaveBeenCalledWith(true);
    expect(values).toEqual([false]);
  });

  it("keeps the prompt available when applying the update fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pwaUpdate = await loadPwaUpdate();
    const values: boolean[] = [];

    pwaUpdate.subscribePwaNeedRefresh((value) => {
      values.push(value);
    });

    pwaUpdate.markPwaNeedRefresh(true);
    pwaUpdate.recordPwaRegistered(() => Promise.reject(new Error("boom")));

    await pwaUpdate.applyPwaUpdate();

    expect(values).toEqual([false, true, false, true]);
  });
});
