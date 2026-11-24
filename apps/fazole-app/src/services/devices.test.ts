import { createId, makeDevicesRepository } from "@linky-fit/linksync";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createDevices, readThisDevice } from "./devices";
import { memoryKv, testStore } from "./testing/fakes";

// Finito's `masterKeyToMnemonic("00112233445566778899aabbccddeeff")`.
const recoverySeed =
  "academic else academic academic canyon album laden hairy debris ladle beard agree glad twin always dance metric lily strike herd";
const userAgent =
  "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

const setupDevices = (whenUploaded: Effect.Effect<void> = Effect.void) => {
  const store = testStore();
  const kv = memoryKv();
  const onRemoved = vi.fn();
  const repository = makeDevicesRepository(store);
  const devices = createDevices({
    repository,
    whenUploaded,
    recoverySeed,
    ports: {
      kv,
      userAgent,
      onRemoved,
      syncServers: () => ["wss://sync.one", "ws://localhost:4000"],
    },
  });
  return { devices, repository, kv, onRemoved };
};

describe("devices", () => {
  it("adds this device as a Fazole device named after its model", async () => {
    const { devices, repository, kv } = setupDevices();
    devices.start();
    await vi.waitFor(() => expect(readThisDevice(kv).joined).toBe(true));
    expect(Effect.runSync(repository.all)).toMatchObject([
      { id: devices.thisDeviceId, app: "fazole", name: "SM-A546B" },
    ]);
  });

  it("signs out once another device removes this one and its own changes reached a relay, saying which", async () => {
    const uploaded = Effect.runSync(Deferred.make<void>());
    const { devices, repository, kv, onRemoved } = setupDevices(
      Deferred.await(uploaded),
    );
    devices.start();
    await vi.waitFor(() => expect(readThisDevice(kv).joined).toBe(true));
    const id = devices.thisDeviceId;
    if (id === null) throw new Error("no device id");
    const phone = createId<"Device">();
    await Effect.runPromise(
      repository.register({
        id: phone,
        app: "linky",
        name: "Pixel 8",
        deviceType: null,
        browserName: null,
        osName: null,
        joining: true,
      }),
    );

    await Effect.runPromise(repository.remove(id, phone));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onRemoved).not.toHaveBeenCalled();
    Effect.runSync(Deferred.succeed(uploaded, undefined));

    await vi.waitFor(() =>
      expect(onRemoved).toHaveBeenCalledExactlyOnceWith("Pixel 8 (Linky)"),
    );
  });

  it("leaves the list on a reset without signing out as removed", async () => {
    const { devices, repository, kv, onRemoved } = setupDevices();
    devices.start();
    await vi.waitFor(() => expect(readThisDevice(kv).joined).toBe(true));

    await devices.leave();

    expect(Effect.runSync(repository.all)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("sends the seed's master secret, the shop's name and its wss sync servers", async () => {
    const { devices } = setupDevices();
    expect(
      await devices.pairingPayload({
        name: "Linden Tree Café",
      }),
    ).toEqual({
      masterKey: "00112233445566778899aabbccddeeff",
      accountName: "Linden Tree Café",
      transports: ["wss://sync.one"],
    });
  });
});
