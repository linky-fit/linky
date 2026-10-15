export const requiresDeviceMotionPermission = (): boolean =>
  typeof DeviceMotionEvent !== "undefined" &&
  typeof Reflect.get(DeviceMotionEvent, "requestPermission") === "function";

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
