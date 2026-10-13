import type {
  PaymentTelemetryAppRuntime,
  PaymentTelemetryDevicePlatform,
} from "@linky-fit/linkstr";
import { Platform } from "react-native";
import { apiOrigin } from "./buildEnv";

export type PlatformTarget = "android" | "ios" | "web";

const HOSTED_APP_ORIGIN = "https://app.linky.fit";

/** The native app has no page host. */
export const getTelemetryAppHost = (): string | null => null;

export const getPlatformTarget = (): PlatformTarget =>
  Platform.OS === "ios" ? "ios" : "android";

export const isNativePlatform = (): boolean => true;

export const isDesktopShell = (): boolean => false;

export const getTelemetryAppRuntime = (): PaymentTelemetryAppRuntime =>
  "native";

export const getTelemetryDevicePlatform = (): PaymentTelemetryDevicePlatform =>
  Platform.OS === "ios" ? "iphone" : "android";

export const isNightlyOrigin = (): boolean => false;

/** URL of a Linky `/api/*` function on the build's API origin. */
export const apiUrl = (path: `/api/${string}`): string =>
  `${apiOrigin || HOSTED_APP_ORIGIN}${path}`;

export const isLocalOrigin = (): boolean => false;

/** URL of a Linky `/api/*` function on the hosted app. */
export const hostedApiUrl = (path: `/api/${string}`): string =>
  `${HOSTED_APP_ORIGIN}${path}`;
