import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadUpdate = async () => {
  vi.resetModules();
  return import("./pwaUpdate");
};

const deferred = () => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const recordValues = (update: Awaited<ReturnType<typeof loadUpdate>>) => {
  const values: boolean[] = [];
  update.subscribeNeedRefresh((value) => values.push(value));
  return values;
};

describe("PWA update", () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockReset();
    vi.stubGlobal("location", { reload });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears and suppresses the banner until the accepted update reloads", async () => {
    vi.useFakeTimers();
    const update = await loadUpdate();
    const values = recordValues(update);
    update.markNeedRefresh(true);
    update.recordRegistered(() => Promise.resolve());

    await update.applyUpdate();
    update.markNeedRefresh(true);
    update.recordControllerChange();
    update.markNeedRefresh(true);

    expect(values).toEqual([false, true, false]);
  });

  it("activates the waiting worker and reloads if it never takes control", async () => {
    vi.useFakeTimers();
    const update = await loadUpdate();
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    update.recordRegistered(updateServiceWorker);

    await update.applyUpdate();
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("holds the update back until wallet work, including work queued meanwhile, settles", async () => {
    const update = await loadUpdate();
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    update.recordRegistered(updateServiceWorker);
    const first = deferred();
    update.deferUpdateWhile(first.promise);

    const applied = update.applyUpdate();
    const queued = deferred();
    update.deferUpdateWhile(queued.promise);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(updateServiceWorker).not.toHaveBeenCalled();

    queued.resolve();
    await applied;
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("does not wait for failed wallet work", async () => {
    const update = await loadUpdate();
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    update.recordRegistered(updateServiceWorker);
    update.deferUpdateWhile(Promise.reject(new Error("mint down")));

    await update.applyUpdate();

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("shows the banner again when applying the update fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const update = await loadUpdate();
    const values = recordValues(update);
    update.markNeedRefresh(true);
    update.recordRegistered(() => Promise.reject(new Error("boom")));

    await update.applyUpdate();

    expect(values).toEqual([false, true, false, true]);
    expect(reload).not.toHaveBeenCalled();
  });
});
