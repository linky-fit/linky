import { describe, expect, it } from "vitest";
import { createEvoluReloadHandler, type EvoluWorkerProbe } from "./evolu.web";

describe("createEvoluReloadHandler", () => {
  const makeHarness = () => {
    let lastProbe: EvoluWorkerProbe | null = null;
    let calls = 0;
    const handler = createEvoluReloadHandler({
      onReload: (probe) => {
        calls += 1;
        lastProbe = probe;
      },
    });
    return {
      handler,
      calls: () => calls,
      probe: () => {
        if (lastProbe === null) throw new Error("expected reloadApp call");
        return lastProbe;
      },
    };
  };

  it("reports the worker alive when the registered probe answers", async () => {
    const { handler, probe } = makeHarness();
    handler.setWorkerProbe(() => Promise.resolve(true));

    handler.reloadApp();

    await expect(probe()(5_000)).resolves.toBe(true);
  });

  it("keeps reporting alive across repeated reloadApp calls from a waiting build", async () => {
    const { handler, probe, calls } = makeHarness();
    handler.setWorkerProbe(() => Promise.resolve(true));

    handler.reloadApp();
    handler.reloadApp();

    expect(calls()).toBe(2);
    await expect(probe()(5_000)).resolves.toBe(true);
  });

  it("reports dead when no probe is registered or the probe times out", async () => {
    const { handler, probe } = makeHarness();

    handler.reloadApp();
    await expect(probe()(5_000)).resolves.toBe(false);

    handler.setWorkerProbe(() => Promise.resolve(false));
    await expect(probe()(5_000)).resolves.toBe(false);
  });

  it("reports dead immediately after a persisted pagehide (bfcache restore)", async () => {
    const { handler, probe } = makeHarness();
    handler.setWorkerProbe(() => Promise.resolve(true));

    handler.onPageHide({ persisted: true });
    handler.reloadApp();

    await expect(probe()(5_000)).resolves.toBe(false);
  });
});
