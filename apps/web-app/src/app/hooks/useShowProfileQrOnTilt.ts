import { useLatest } from "../../hooks/useLatest";
import React from "react";

interface UseShowProfileQrOnTiltParams {
  enabled: boolean;
  onShowProfileQr: () => void;
}

const ORIENTATION_TILT_DELTA = 35;
const ORIENTATION_RESET_DELTA = 12;
const GRAVITY_TILT_DELTA = 3.2;
const GRAVITY_RESET_DELTA = 1.2;
const OPEN_COOLDOWN_MS = 2500;

export const getAngleDelta = (value: number, baseline: number): number => {
  let delta = value - baseline;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

export const isProfileQrTilt = (beta: number, baseline: number): boolean =>
  Math.abs(getAngleDelta(beta, baseline)) >= ORIENTATION_TILT_DELTA;

export const isResetTilt = (beta: number, baseline: number): boolean =>
  Math.abs(getAngleDelta(beta, baseline)) <= ORIENTATION_RESET_DELTA;

export const isMotionProfileQrTilt = (
  gravityY: number,
  baseline: number,
): boolean => Math.abs(gravityY - baseline) >= GRAVITY_TILT_DELTA;

export const isMotionResetTilt = (
  gravityY: number,
  baseline: number,
): boolean => Math.abs(gravityY - baseline) <= GRAVITY_RESET_DELTA;

export const normalizeScreenAngle = (angle: number): number => {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const isScreenProfileQrTilt = ({
  angle,
  type,
}: {
  angle: number | null;
  type: string | null;
}): boolean => {
  if (type === "portrait-secondary") return true;
  return angle !== null && normalizeScreenAngle(angle) === 180;
};

export const isScreenResetTilt = ({
  angle,
  type,
}: {
  angle: number | null;
  type: string | null;
}): boolean => {
  if (type === "portrait-primary") return true;
  return angle !== null && normalizeScreenAngle(angle) === 0;
};

const readFiniteNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readScreenOrientation = (): {
  angle: number | null;
  type: string | null;
} => {
  const orientation = window.screen.orientation;
  const angle =
    readFiniteNumber(orientation?.angle) ??
    readFiniteNumber(Reflect.get(window, "orientation"));

  return {
    angle,
    type: readString(orientation?.type),
  };
};

export const useShowProfileQrOnTilt = ({
  enabled,
  onShowProfileQr,
}: UseShowProfileQrOnTiltParams): void => {
  const armedRef = React.useRef(true);
  const baselineBetaRef = React.useRef<number | null>(null);
  const baselineGravityYRef = React.useRef<number | null>(null);
  const lastOpenedAtRef = React.useRef(0);
  const motionTiltedRef = React.useRef(false);
  const orientationTiltedRef = React.useRef(false);
  const onShowProfileQrRef = useLatest(onShowProfileQr);
  const screenTiltedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) {
      armedRef.current = true;
      baselineBetaRef.current = null;
      baselineGravityYRef.current = null;
      motionTiltedRef.current = false;
      orientationTiltedRef.current = false;
      screenTiltedRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;

    const maybeOpenProfileQr = () => {
      if (
        !motionTiltedRef.current &&
        !orientationTiltedRef.current &&
        !screenTiltedRef.current
      ) {
        return;
      }
      const now = Date.now();
      if (now - lastOpenedAtRef.current < OPEN_COOLDOWN_MS) return;

      armedRef.current = false;
      lastOpenedAtRef.current = now;
      onShowProfileQrRef.current();
    };

    const maybeResetTilt = () => {
      if (
        motionTiltedRef.current ||
        orientationTiltedRef.current ||
        screenTiltedRef.current
      ) {
        return;
      }
      armedRef.current = true;
    };

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      const beta = readFiniteNumber(event.beta);
      if (beta === null) return;
      const baselineBeta = baselineBetaRef.current;
      if (baselineBeta === null) {
        baselineBetaRef.current = beta;
        return;
      }

      if (isProfileQrTilt(beta, baselineBeta)) {
        orientationTiltedRef.current = true;
        if (armedRef.current) maybeOpenProfileQr();
        return;
      }

      if (isResetTilt(beta, baselineBeta)) {
        orientationTiltedRef.current = false;
        maybeResetTilt();
        return;
      }
    };

    const onDeviceMotion = (event: DeviceMotionEvent) => {
      const gravityY = readFiniteNumber(event.accelerationIncludingGravity?.y);
      if (gravityY === null) return;
      const baselineGravityY = baselineGravityYRef.current;
      if (baselineGravityY === null) {
        baselineGravityYRef.current = gravityY;
        return;
      }

      if (isMotionProfileQrTilt(gravityY, baselineGravityY)) {
        motionTiltedRef.current = true;
        if (armedRef.current) maybeOpenProfileQr();
        return;
      }

      if (isMotionResetTilt(gravityY, baselineGravityY)) {
        motionTiltedRef.current = false;
        maybeResetTilt();
        return;
      }
    };

    const onScreenOrientationChange = () => {
      const screenOrientation = readScreenOrientation();

      if (isScreenProfileQrTilt(screenOrientation)) {
        screenTiltedRef.current = true;
        if (armedRef.current) maybeOpenProfileQr();
        return;
      }

      if (isScreenResetTilt(screenOrientation)) {
        screenTiltedRef.current = false;
        maybeResetTilt();
        return;
      }
    };

    window.addEventListener("deviceorientation", onDeviceOrientation, {
      passive: true,
    });
    window.addEventListener("devicemotion", onDeviceMotion, {
      passive: true,
    });
    window.screen.orientation?.addEventListener(
      "change",
      onScreenOrientationChange,
    );
    window.addEventListener("orientationchange", onScreenOrientationChange, {
      passive: true,
    });
    window.addEventListener("resize", onScreenOrientationChange, {
      passive: true,
    });
    onScreenOrientationChange();

    return () => {
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      window.removeEventListener("devicemotion", onDeviceMotion);
      window.screen.orientation?.removeEventListener(
        "change",
        onScreenOrientationChange,
      );
      window.removeEventListener(
        "orientationchange",
        onScreenOrientationChange,
      );
      window.removeEventListener("resize", onScreenOrientationChange);
    };
  }, [enabled, onShowProfileQrRef]);
};
