import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseBeacon } from "../app/hooks/useBeacon";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { NearbyBeaconSection } from "./NearbyBeaconSection";

const beacon = vi.hoisted(() => {
  const state: { current: UseBeacon | null } = { current: null };
  return state;
});

vi.mock("../app/hooks/useBeacon", () => ({
  useBeacon: () => beacon.current,
}));

const platform = vi.hoisted((): { target: "android" | "ios" } => ({
  target: "android",
}));

vi.mock("../platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/runtime")>()),
  getPlatformTarget: () => platform.target,
}));

const makeBeacon = (overrides: Partial<UseBeacon> = {}): UseBeacon => ({
  enabled: false,
  setEnabled: vi.fn(async () => {}),
  trade: "none",
  setTrade: vi.fn(),
  permission: "granted",
  requestPermissions: vi.fn(),
  status: { running: true, bluetoothOn: true, advertising: true, error: null },
  introSeen: false,
  markIntroSeen: vi.fn(),
  keyCount: 12,
  ...overrides,
});

const render = (overrides: Partial<UseBeacon> = {}) => {
  beacon.current = makeBeacon(overrides);
  return renderIntoDocument(<NearbyBeaconSection t={(key) => key} />);
};

const press = (element: Element | null | undefined) =>
  act(async () => {
    if (!(element instanceof HTMLElement)) throw new Error("Missing element");
    element.click();
  });

const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );

describe("NearbyBeaconSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    platform.target = "android";
  });

  it.each([
    [{ enabled: false }, "beaconStatusOff"],
    [
      { enabled: true, permission: "denied" as const },
      "beaconStatusPermissionNeeded",
    ],
    [
      {
        enabled: true,
        status: {
          running: false,
          bluetoothOn: false,
          advertising: false,
          error: null,
        },
      },
      "beaconStatusBluetoothOff",
    ],
    [
      {
        enabled: true,
        status: {
          running: false,
          bluetoothOn: true,
          advertising: false,
          error: "start_not_allowed",
        },
      },
      "beaconStatusNotBroadcasting",
    ],
    [
      {
        enabled: true,
        status: {
          running: true,
          bluetoothOn: true,
          advertising: false,
          error: "advertise_failed_1",
        },
      },
      "beaconStatusNotBroadcasting",
    ],
    [{ enabled: true, keyCount: 1 }, "beaconStatusBroadcastingOne"],
    [{ enabled: true }, "beaconStatusBroadcastingOther"],
  ])("shows the status of %o", async (overrides, status) => {
    const { container, unmount } = await render(overrides);
    expect(container.textContent).toContain(status);
    await unmount();
  });

  it("shows the intro before the first switch-on and turns on from it", async () => {
    const { container, unmount } = await render();
    await press(container.querySelector('[role="switch"]'));
    expect(beacon.current?.setEnabled).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("beaconIntroNpub");
    expect(document.body.textContent).toContain("beaconIntroBluetooth");
    expect(document.body.textContent).not.toContain("beaconIntroBluetoothIos");

    await press(button("beaconTurnOn"));
    expect(beacon.current?.markIntroSeen).toHaveBeenCalledOnce();
    expect(beacon.current?.setEnabled).toHaveBeenCalledWith(true);
    await unmount();
  });

  it("says on iOS that the beacon runs in the background instead of keeping a notification", async () => {
    platform.target = "ios";
    const { container, unmount } = await render();
    await press(container.querySelector('[role="switch"]'));
    expect(document.body.textContent).toContain("beaconIntroBluetoothIos");
    await unmount();
  });

  it("leaves the beacon off when the intro is dismissed", async () => {
    const { container, unmount } = await render();
    await press(container.querySelector('[role="switch"]'));
    await press(button("beaconNotNow"));
    expect(beacon.current?.markIntroSeen).not.toHaveBeenCalled();
    expect(beacon.current?.setEnabled).not.toHaveBeenCalled();
    await unmount();
  });

  it("offers the beacon once per session when the page opens with it off", async () => {
    beacon.current = makeBeacon();
    const first = await renderIntoDocument(
      <NearbyBeaconSection offerOnMount t={(key) => key} />,
    );
    expect(document.body.textContent).toContain("beaconIntroNpub");
    await press(button("beaconNotNow"));
    expect(beacon.current?.setEnabled).not.toHaveBeenCalled();
    await first.unmount();

    const second = await renderIntoDocument(
      <NearbyBeaconSection offerOnMount t={(key) => key} />,
    );
    expect(button("beaconTurnOn")).toBeUndefined();
    await second.unmount();
  });

  it("turns on without the intro once it was seen", async () => {
    const { container, unmount } = await render({ introSeen: true });
    await press(container.querySelector('[role="switch"]'));
    expect(beacon.current?.setEnabled).toHaveBeenCalledWith(true);
    expect(button("beaconTurnOn")).toBeUndefined();
    await unmount();
  });
});
