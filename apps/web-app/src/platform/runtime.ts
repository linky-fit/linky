import { Capacitor } from "@capacitor/core";
import {
  detectTelemetryEnvironment,
  type PaymentTelemetryAppRuntime,
  type PaymentTelemetryDevicePlatform,
  type TelemetryEnvironment,
  type TelemetryEnvironmentFacts,
} from "@linky/linkstr";

type PlatformTarget = "android" | "ios" | "web";

export const getTelemetryAppHost = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const host = window.location.host.trim().toLowerCase();

  return host ? host.slice(0, 255) : null;
};

const getNavigator = (): Navigator | null => {
  return typeof navigator === "undefined" ? null : navigator;
};

const getNavigatorStandalone = (): boolean => {
  const browserNavigator = getNavigator();
  const standalone = Reflect.get(browserNavigator ?? {}, "standalone");
  return standalone === true;
};

const getNavigatorMaxTouchPoints = (): number => {
  const browserNavigator = getNavigator();
  return typeof browserNavigator?.maxTouchPoints === "number"
    ? browserNavigator.maxTouchPoints
    : 0;
};

const matchesStandaloneDisplayMode = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
};

export const getPlatformTarget = (): PlatformTarget => {
  try {
    const platform = Capacitor.getPlatform();
    if (platform === "android" || platform === "ios") {
      return platform;
    }
  } catch {
    // ignore
  }

  return "web";
};

export const isNativePlatform = (): boolean => {
  try {
    if (Capacitor.isNativePlatform()) {
      return true;
    }
  } catch {
    // ignore
  }

  return getPlatformTarget() !== "web";
};

const getNativePlatform = (): TelemetryEnvironmentFacts["nativePlatform"] => {
  const target = getPlatformTarget();
  return target === "web" ? null : target;
};

const getTelemetryEnvironment = (): TelemetryEnvironment =>
  detectTelemetryEnvironment({
    userAgent: getNavigator()?.userAgent ?? "",
    maxTouchPoints: getNavigatorMaxTouchPoints(),
    displayModeStandalone: matchesStandaloneDisplayMode(),
    navigatorStandalone: getNavigatorStandalone(),
    nativePlatform: getNativePlatform(),
  });

export const getTelemetryAppRuntime = (): PaymentTelemetryAppRuntime =>
  getTelemetryEnvironment().appRuntime;

export const getTelemetryDevicePlatform = (): PaymentTelemetryDevicePlatform =>
  getTelemetryEnvironment().devicePlatform;
