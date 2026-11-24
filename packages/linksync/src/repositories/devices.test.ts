import { createId } from "@linky-fit/domain";
import { describe, expect, it } from "vitest";
import { linkyStore, runNow } from "../testing/linky";
import { type DeviceRegistration, makeDevicesRepository } from "./devices";

const phone: DeviceRegistration = {
  id: createId<"Device">(),
  app: "linky",
  name: "Samsung SM-A546B",
  deviceType: "mobile",
  browserName: "Chrome",
  osName: "Android",
  joining: true,
};

describe("devices repository", () => {
  it("lists a registered device with its app and name", () => {
    const { store } = linkyStore();
    const devices = makeDevicesRepository(store);
    expect(runNow(devices.register(phone))).toBe("registered");
    expect(runNow(devices.all)).toMatchObject([
      { id: phone.id, app: "linky", name: "Samsung SM-A546B" },
    ]);
  });

  it("registering again keeps the name another device set", () => {
    const { store } = linkyStore();
    const devices = makeDevicesRepository(store);
    runNow(devices.register(phone));
    runNow(devices.rename(phone.id, "Work phone"));
    runNow(
      devices.register({
        ...phone,
        joining: false,
        browserName: "Firefox",
      }),
    );
    expect(runNow(devices.all)).toMatchObject([
      { name: "Work phone", browserName: "Firefox" },
    ]);
  });

  it("a start that changes nothing writes nothing", () => {
    const { store } = linkyStore();
    const devices = makeDevicesRepository(store);
    runNow(devices.register(phone));
    let changes = 0;
    devices.subscribe(() => changes++);
    runNow(devices.register({ ...phone, joining: false }));
    expect(changes).toBe(0);
  });

  it("a device removed from another one is told which one and does not come back", () => {
    const { store } = linkyStore();
    const devices = makeDevicesRepository(store);
    const laptop = {
      ...phone,
      id: createId<"Device">(),
      app: "fazole",
      name: "MacBook",
    } as const;
    runNow(devices.register(phone));
    runNow(devices.register(laptop));
    expect(runNow(devices.removal(phone.id))).toBeNull();

    runNow(devices.remove(phone.id, laptop.id));

    expect(runNow(devices.removal(phone.id))).toMatchObject({
      by: { name: "MacBook", app: "fazole" },
    });
    expect(runNow(devices.register({ ...phone, joining: false }))).toBe(
      "removed",
    );
    expect(runNow(devices.all)).toMatchObject([{ id: laptop.id }]);
  });

  it("a device joining again rejoins over its old removal, keeping its name", () => {
    const { store } = linkyStore();
    const devices = makeDevicesRepository(store);
    runNow(devices.register(phone));
    runNow(devices.rename(phone.id, "Work phone"));
    runNow(devices.remove(phone.id, createId<"Device">()));
    expect(runNow(devices.register(phone))).toBe("registered");
    expect(runNow(devices.removal(phone.id))).toBeNull();
    expect(runNow(devices.all)).toMatchObject([{ name: "Work phone" }]);
  });
});
