import React from "react";
import { useLatest } from "../../hooks/useLatest";
import { onGravityY, STANDARD_GRAVITY } from "../../platform/deviceMotion";

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

/**
 * Reports transitions of the phone being held with the top of the screen
 * pointing down (the "show my screen to someone across from me" gesture).
 * Gravity readings (`onGravityY`) feed the hysteresis.
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
    if (!enabled) return;

    let topDown = false;
    const onElevation = (elevationDeg: number) => {
      const next = nextTopDownState(topDown, elevationDeg);
      if (next === topDown) return;
      topDown = next;
      onChangeRef.current(next);
    };

    const unsubscribe = onGravityY((gravityY) =>
      onElevation(gravityYToElevationDeg(gravityY)),
    );

    return () => {
      unsubscribe();
      if (topDown) onChangeRef.current(false);
    };
  }, [enabled, onChangeRef]);
};
