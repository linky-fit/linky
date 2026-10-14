import { DeviceMotion, type DeviceMotionMeasurement } from "expo-sensors";

export const STANDARD_GRAVITY = 9.81;

const UPDATE_INTERVAL_MS = 100;

export const requiresDeviceMotionPermission = (): boolean => false;

// The orientation sensors need no permission; expo-sensors would ask for physical activity.
export const requestDeviceMotionPermission = async (): Promise<boolean> => true;

/**
 * Calls `listener` with the gravity component along the screen's Y axis, in
 * m/s², from the device pitch: both platforms report it as the web's
 * `deviceorientation` beta, in radians.
 */
export const onGravityY = (
  listener: (gravityY: number) => void,
): (() => void) => {
  DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS);
  // On Android, events before the first rotation-vector reading carry no `rotation`.
  const subscription = DeviceMotion.addListener(
    ({ rotation }: Partial<DeviceMotionMeasurement>) => {
      if (rotation && Number.isFinite(rotation.beta))
        listener(Math.sin(rotation.beta) * STANDARD_GRAVITY);
    },
  );
  return () => subscription.remove();
};
