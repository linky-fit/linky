// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { supportsDeviceMotion } from "./deviceMotion";

const runtime: {
  desktop: boolean;
  native: boolean;
  devicePlatform: "android" | "desktop" | "ipad" | "iphone";
} = vi.hoisted(() => ({
  desktop: false,
  native: false,
  devicePlatform: "desktop",
}));

vi.mock("./runtime", () => ({
  getTelemetryDevicePlatform: () => runtime.devicePlatform,
  isDesktopShell: () => runtime.desktop,
  isNativePlatform: () => runtime.native,
}));

const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
  navigator,
  "maxTouchPoints",
);
const originalMatchMedia = window.matchMedia;

const stubTouch = (points: number, coarse: boolean) => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: points,
  });
  window.matchMedia = vi.fn().mockReturnValue({ matches: coarse });
};

afterEach(() => {
  runtime.desktop = false;
  runtime.native = false;
  runtime.devicePlatform = "desktop";
  vi.unstubAllGlobals();
  if (originalMaxTouchPoints) {
    Object.defineProperty(navigator, "maxTouchPoints", originalMaxTouchPoints);
  }
  window.matchMedia = originalMatchMedia;
});

describe("supportsDeviceMotion", () => {
  it("hides tilt on desktop browsers without touch, even when requestPermission exists", () => {
    vi.stubGlobal("DeviceMotionEvent", { requestPermission: vi.fn() });
    stubTouch(0, false);
    expect(supportsDeviceMotion()).toBe(false);
  });

  it("hides tilt in the Electron desktop shell", () => {
    runtime.desktop = true;
    stubTouch(5, true);
    expect(supportsDeviceMotion()).toBe(false);
  });

  it("shows tilt on touch mobile browsers and native builds", () => {
    vi.stubGlobal("DeviceMotionEvent", function DeviceMotionEvent() {});
    stubTouch(5, true);
    expect(supportsDeviceMotion()).toBe(true);

    stubTouch(0, false);
    runtime.native = true;
    expect(supportsDeviceMotion()).toBe(true);
  });
});
