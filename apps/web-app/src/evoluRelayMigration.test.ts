import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createDatabase = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => createDatabase,
}));

const relay = "wss://evolu.linky.fit";
const custom = "wss://sync.example.com";
const serversKey = "linky.evoluServers.v1";
const disabledKey = "linky.evoluServers.disabled.v1";
const removedKey = "linky.evoluServers.defaultRemoved.v1";
const migrationKey = "linky.evoluServers.linkyRelayAdded.v1";

const boot = async () => {
  vi.resetModules();
  createDatabase.mockClear();
  await import("./evolu");
};

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_EVOLU_SERVER_URLS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Linky Evolu relay upgrade", () => {
  it("adds and enables Linky before creating the database, preserving custom settings", async () => {
    localStorage.setItem(serversKey, JSON.stringify([custom]));
    localStorage.setItem(removedKey, "true");
    localStorage.setItem(disabledKey, JSON.stringify([relay + "/", custom]));

    await boot();

    expect(localStorage.getItem(serversKey)).toBe(
      JSON.stringify([custom, relay]),
    );
    expect(localStorage.getItem(removedKey)).toBe("true");
    expect(localStorage.getItem(disabledKey)).toBe(JSON.stringify([custom]));
    expect(localStorage.getItem(migrationKey)).toBe("true");
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transports: [{ type: "WebSocket", url: relay }],
      }),
    );
  });

  it("does not duplicate Linky and respects removal after the migration", async () => {
    localStorage.setItem(serversKey, JSON.stringify([custom, relay + "/"]));
    localStorage.setItem(removedKey, "true");
    await boot();
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transports: [custom, relay].map((url) => ({ type: "WebSocket", url })),
      }),
    );

    localStorage.setItem(serversKey, JSON.stringify([custom]));
    await boot();
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transports: [{ type: "WebSocket", url: custom }],
      }),
    );
  });

  it("respects disabling Linky after the migration", async () => {
    await boot();
    localStorage.setItem(disabledKey, JSON.stringify([relay]));
    await boot();
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transports: [{ type: "WebSocket", url: "wss://free.evoluhq.com" }],
      }),
    );
  });

  it("keeps environment overrides isolated from production", async () => {
    vi.stubEnv("VITE_EVOLU_SERVER_URLS", "ws://localhost:4001");
    await boot();
    expect(localStorage.getItem(migrationKey)).toBeNull();
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transports: [{ type: "WebSocket", url: "ws://localhost:4001" }],
      }),
    );
  });

  it("does not mark a failed storage write complete", async () => {
    localStorage.setItem(removedKey, "true");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage full");
      });
    await boot();
    expect(localStorage.getItem(migrationKey)).toBeNull();
    setItem.mockRestore();
    await boot();
    expect(localStorage.getItem(migrationKey)).toBe("true");
  });
});
