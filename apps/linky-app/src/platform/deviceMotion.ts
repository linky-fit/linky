export const STANDARD_GRAVITY = 9.81;

const readFiniteNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

/**
 * Calls `listener` with the gravity component along the screen's Y axis, in
 * m/s². It comes from `devicemotion` where available and from the
 * `deviceorientation` pitch otherwise.
 */
export const onGravityY = (
  listener: (gravityY: number) => void,
): (() => void) => {
  const onDeviceMotion = (event: DeviceMotionEvent) => {
    const gravityY = readFiniteNumber(event.accelerationIncludingGravity?.y);
    if (gravityY !== null) listener(gravityY);
  };
  const onDeviceOrientation = (event: DeviceOrientationEvent) => {
    const beta = readFiniteNumber(event.beta);
    // beta is the pitch around the device X axis; its sine is the
    // normalized gravity Y component, so both sources agree.
    if (beta !== null)
      listener(Math.sin((beta * Math.PI) / 180) * STANDARD_GRAVITY);
  };
  window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
  window.addEventListener("deviceorientation", onDeviceOrientation, {
    passive: true,
  });
  return () => {
    window.removeEventListener("devicemotion", onDeviceMotion);
    window.removeEventListener("deviceorientation", onDeviceOrientation);
  };
};
