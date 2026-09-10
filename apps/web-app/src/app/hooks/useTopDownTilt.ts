import React from "react";
import { useLatest } from "../../hooks/useLatest";
import { requestDeviceMotionPermission } from "../../platform/deviceMotion";

const STANDARD_GRAVITY = 9.81;
// Hysteresis in degrees of the screen-top elevation: negative means the top
// edge points below the horizon. Enter well past horizontal so a jostle never
// triggers, leave close to horizontal so bringing the phone back always resets.
const TOP_DOWN_ENTER_DEG = -35;
const TOP_DOWN_EXIT_DEG = -15;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Elevation of the screen's top edge from the device-frame gravity Y component. */
export const gravityYToElevationDeg = (gravityY: number): number =>
  (Math.asin(clamp(gravityY / STANDARD_GRAVITY, -1, 1)) * 180) / Math.PI;

export const nextTopDownState = (
  wasTopDown: boolean,
  elevationDeg: number,
): boolean =>
  wasTopDown
    ? elevationDeg <= TOP_DOWN_EXIT_DEG
    : elevationDeg <= TOP_DOWN_ENTER_DEG;

const readFiniteNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Reports transitions of the phone being held with the top of the screen
 * pointing down (the "show my screen to someone across from me" gesture).
 * Gravity comes from `devicemotion` where available and from the
 * `deviceorientation` pitch otherwise; both feed the same hysteresis.
 */
export const useTopDownTilt = ({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (topDown: boolean) => void;
}): void => {
  const onChangeRef = useLatest(onChange);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let topDown = false;
    const onElevation = (elevationDeg: number) => {
      const next = nextTopDownState(topDown, elevationDeg);
      if (next === topDown) return;
      topDown = next;
      onChangeRef.current(next);
    };

    const onDeviceMotion = (event: DeviceMotionEvent) => {
      const gravityY = readFiniteNumber(event.accelerationIncludingGravity?.y);
      if (gravityY !== null) onElevation(gravityYToElevationDeg(gravityY));
    };
    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      const beta = readFiniteNumber(event.beta);
      // beta is the pitch around the device X axis; its sine is the
      // normalized gravity Y component, so both sources agree.
      if (beta !== null) {
        onElevation(
          gravityYToElevationDeg(
            Math.sin((beta * Math.PI) / 180) * STANDARD_GRAVITY,
          ),
        );
      }
    };

    // Listeners are harmless without permission; events start flowing once a
    // gesture-driven request (settings toggle, profile page) is granted.
    void requestDeviceMotionPermission();
    window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
    window.addEventListener("deviceorientation", onDeviceOrientation, {
      passive: true,
    });

    return () => {
      window.removeEventListener("devicemotion", onDeviceMotion);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      if (topDown) onChangeRef.current(false);
    };
  }, [enabled, onChangeRef]);
};
