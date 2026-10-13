// The tilt gesture waits for expo-sensors (P5b).

export const STANDARD_GRAVITY = 9.81;

export const requiresDeviceMotionPermission = (): boolean => false;

export const requestDeviceMotionPermission = async (): Promise<boolean> =>
  false;

export const onGravityY: (listener: (gravityY: number) => void) => () => void =
  () => () => {};
