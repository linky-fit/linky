import {
  getTelemetryDevicePlatform,
  isDesktopShell,
  isNativePlatform,
} from "./runtime";

export const requiresDeviceMotionPermission = (): boolean =>
  typeof DeviceMotionEvent !== "undefined" &&
  typeof Reflect.get(DeviceMotionEvent, "requestPermission") === "function";

/** Whether this device exposes tilt sensors; desktop browsers define DeviceMotionEvent without hardware. */
export const supportsDeviceMotion = (): boolean => {
  if (typeof window === "undefined" || isDesktopShell()) return false;
  if (isNativePlatform()) return true;
  if (
    typeof DeviceMotionEvent === "undefined" &&
    typeof DeviceOrientationEvent === "undefined"
  ) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return true;
  }
  try {
    if (window.matchMedia("(any-pointer: coarse)").matches) return true;
  } catch {
    // ignore
  }
  const device = getTelemetryDevicePlatform();
  return device === "android" || device === "iphone" || device === "ipad";
};

// Call from a user gesture so Safari can show its permission prompt.
export const requestDeviceMotionPermission = async (): Promise<boolean> => {
  if (typeof DeviceMotionEvent === "undefined") return true;
  const request = Reflect.get(DeviceMotionEvent, "requestPermission");
  if (typeof request !== "function") return true;
  try {
    return (await Reflect.apply(request, DeviceMotionEvent, [])) === "granted";
  } catch {
    return false;
  }
};
