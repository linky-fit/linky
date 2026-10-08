import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseBeacon } from "../app/hooks/useBeacon";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { NearbyBeaconSection } from "./ProxyPaymentsPage";

const beacon = vi.hoisted(() => {
  const state: { current: UseBeacon | null } = { current: null };
  return state;
});

vi.mock("../app/hooks/useBeacon", () => ({
  useBeacon: () => beacon.current,
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
    [{ enabled: true }, "beaconStatusBroadcasting"],
  ])("shows the status of %o", async (overrides, status) => {
    const { container, unmount } = await render(overrides);
    expect(container.textContent).toContain(status);
    await unmount();
  });

  it("disables the trade while the beacon is off", async () => {
    const { container, unmount } = await render();
    const trades = container.querySelectorAll('[role="radio"]');
    expect(trades).toHaveLength(3);
    for (const trade of trades)
      expect(trade.getAttribute("aria-disabled")).toBe("true");
    await unmount();
  });

  it("shows the intro before the first switch-on and turns on from it", async () => {
    const { container, unmount } = await render();
    await press(container.querySelector('[role="switch"]'));
    expect(beacon.current?.setEnabled).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("beaconIntroNpub");

    await press(button("beaconTurnOn"));
    expect(beacon.current?.markIntroSeen).toHaveBeenCalledOnce();
    expect(beacon.current?.setEnabled).toHaveBeenCalledWith(true);
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

  it("turns on without the intro once it was seen", async () => {
    const { container, unmount } = await render({ introSeen: true });
    await press(container.querySelector('[role="switch"]'));
    expect(beacon.current?.setEnabled).toHaveBeenCalledWith(true);
    expect(button("beaconTurnOn")).toBeUndefined();
    await unmount();
  });
});
