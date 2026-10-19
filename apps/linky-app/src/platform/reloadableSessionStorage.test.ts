import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../testUtils/appRegistry";
import {
  clearSessionForLogout,
  HANDLED_LAUNCH_URL_KEY,
  keepSessionStorageForReload,
  makeReloadableSessionStorage,
} from "./reloadableSessionStorage";

describe("makeReloadableSessionStorage", () => {
  it("starts empty on a cold start and keeps what is set", () => {
    const { ports } = memoryKvPorts();
    const storage = makeReloadableSessionStorage(ports.kv);
    expect(storage.length).toBe(0);
    storage.setItem("tour", "done");
    storage.setItem("spd-1", "SPD*1.0");
    storage.removeItem("tour");
    expect(storage.getItem("spd-1")).toBe("SPD*1.0");
    expect(storage.length).toBe(1);
  });

  it("carries the kept entries over a reload, once", () => {
    const { ports } = memoryKvPorts();
    keepSessionStorageForReload(ports.kv, [["spd-1", "SPD*1.0*ACC:CZ"]]);

    const afterReload = makeReloadableSessionStorage(ports.kv);
    expect(afterReload.getItem("spd-1")).toBe("SPD*1.0*ACC:CZ");
    expect(afterReload.length).toBe(1);
    expect(afterReload.key(0)).toBe("spd-1");

    expect(makeReloadableSessionStorage(ports.kv).length).toBe(0);
  });

  it("ignores a snapshot it cannot read", () => {
    const { ports } = memoryKvPorts({
      "linky.native.sessionStorage": "{broken",
    });
    expect(makeReloadableSessionStorage(ports.kv).length).toBe(0);
  });
});

describe("clearSessionForLogout", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubSession = () => {
    const storage = makeReloadableSessionStorage(memoryKvPorts().ports.kv);
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem("spd-1", "SPD*1.0");
    return storage;
  };

  it("keeps only the launch URL the run handled", () => {
    const storage = stubSession();
    storage.setItem(HANDLED_LAUNCH_URL_KEY, "nostrconnect://abc");

    clearSessionForLogout();

    expect(storage.length).toBe(1);
    expect(storage.getItem(HANDLED_LAUNCH_URL_KEY)).toBe("nostrconnect://abc");
  });

  it("empties a session that handled no launch URL", () => {
    const storage = stubSession();

    clearSessionForLogout();

    expect(storage.length).toBe(0);
  });
});
