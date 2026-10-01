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
