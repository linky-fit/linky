import type {
  PaymentTelemetryAppRuntime,
  PaymentTelemetryDevicePlatform,
} from "./domain";

export interface TelemetryEnvironmentFacts {
  userAgent: string;
  maxTouchPoints: number;
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
  /** Set by hosts that know they run inside a native shell (e.g. Capacitor). */
  nativePlatform: "android" | "ios" | null;
}

export interface TelemetryEnvironment {
  devicePlatform: PaymentTelemetryDevicePlatform;
  appRuntime: PaymentTelemetryAppRuntime;
}

const detectDevicePlatform = (
  facts: TelemetryEnvironmentFacts,
): PaymentTelemetryDevicePlatform => {
  const userAgent = facts.userAgent.toLowerCase();

  if (facts.nativePlatform === "android" || userAgent.includes("android")) {
    return "android";
  }
  if (userAgent.includes("iphone") || userAgent.includes("ipod")) {
    return "iphone";
  }
  if (userAgent.includes("ipad")) {
    return "ipad";
  }
  if (facts.nativePlatform === "ios") {
    return "iphone";
  }
  // iPadOS Safari reports a desktop Macintosh user agent; touch support tells it apart.
  if (userAgent.includes("macintosh") && facts.maxTouchPoints > 1) {
    return "ipad";
  }
  if (userAgent.includes("macintosh") || userAgent.includes("mac os x")) {
    return "mac";
  }
  if (userAgent.includes("windows")) {
    return "windows";
  }
  if (userAgent.includes("linux") || userAgent.includes("x11")) {
    return "linux";
  }
  return "unknown";
};

const detectAppRuntime = (
  facts: TelemetryEnvironmentFacts,
): PaymentTelemetryAppRuntime => {
  if (facts.nativePlatform !== null) return "native";
  if (facts.displayModeStandalone || facts.navigatorStandalone) return "pwa";
  return "web";
};

export const detectTelemetryEnvironment = (
  facts: TelemetryEnvironmentFacts,
): TelemetryEnvironment => ({
  devicePlatform: detectDevicePlatform(facts),
  appRuntime: detectAppRuntime(facts),
});
