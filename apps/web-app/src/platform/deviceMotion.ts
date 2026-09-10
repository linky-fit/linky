// Safari on iOS 13+ only delivers motion events after a permission prompt that
// must be triggered from a user gesture. Chrome exposes the same method but
// resolves "granted" without prompting; browsers without it need nothing.
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
