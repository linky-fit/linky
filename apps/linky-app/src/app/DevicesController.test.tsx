import { createId, makeDevicesRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLogoutPending } from "../platform/logoutWipe";
import { makeTestLinkyStore } from "../testUtils/linkyStore";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { DevicesController } from "./DevicesController";
import { markThisDeviceJoined, readThisDevice } from "./lib/thisDevice";

const { reload, testStore } = vi.hoisted(() => {
  const holder: { current: ReturnType<typeof makeTestLinkyStore> | null } = {
    current: null,
  };
  return { reload: vi.fn(), testStore: holder };
});

const store = () => {
  if (testStore.current === null) throw new Error("no test store");
  return testStore.current.store;
};

vi.mock("./hooks/useLinksync", async () => {
  const { makeDevicesRepository: make } = await import("@linky-fit/linksync");
  const repositories = new WeakMap<object, ReturnType<typeof make>>();
  return {
    useLinkyStore: () => store(),
    useDevicesRepository: () => {
      const current = store();
      const existing = repositories.get(current) ?? make(current);
      repositories.set(current, existing);
      return existing;
    },
  };
});
vi.mock("@linky-fit/linksync/react", () => ({ useHydrated: () => true }));
vi.mock("@linky-fit/linkstr-react", () => ({
  useAtomValue: () => ({ lifecycle: { reload } }),
}));
vi.mock("../platform/identitySecrets", () => ({
  clearIdentitySecrets: () => Promise.resolve(),
}));
vi.mock("../platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/runtime")>()),
  getUserAgent: () =>
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
}));

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  testStore.current = makeTestLinkyStore();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("DevicesController", () => {
  it("adds this device to the list once, named after its browser", async () => {
    const { unmount } = await renderIntoDocument(<DevicesController />);
    await flush();

    const devices = makeDevicesRepository(store());
    const { id, joined } = readThisDevice();
    expect(joined).toBe(true);
    expect(Effect.runSync(devices.all)).toMatchObject([
      { id, app: "linky", name: "Safari · macOS", osName: "macOS" },
    ]);
    await unmount();
  });

  it("signs out when another device removes this one while it runs, naming that device", async () => {
    const { unmount } = await renderIntoDocument(<DevicesController />);
    await flush();
    const devices = makeDevicesRepository(store());
    const shop = createId<"Device">();
    Effect.runSync(
      devices.register({
        id: shop,
        app: "fazole",
        name: "Shop tablet",
        deviceType: null,
        browserName: null,
        osName: null,
        joining: true,
      }),
    );

    await act(() =>
      Effect.runPromise(devices.remove(readThisDevice().id, shop)),
    );
    await flush();

    expect(isLogoutPending()).toBe(true);
    expect(localStorage.getItem("linky.removedFromDevices")).toBe(
      "Shop tablet (Fazole)",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("signs out at start when it was removed while away", async () => {
    const devices = makeDevicesRepository(store());
    const { id } = readThisDevice();
    Effect.runSync(
      devices.register({
        id,
        app: "linky",
        name: "Old phone",
        deviceType: null,
        browserName: null,
        osName: null,
        joining: true,
      }),
    );
    markThisDeviceJoined(id);
    Effect.runSync(devices.remove(id, createId<"Device">()));

    const { unmount } = await renderIntoDocument(<DevicesController />);
    await flush();

    expect(isLogoutPending()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
