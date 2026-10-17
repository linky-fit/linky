import { Schema } from "effect";

// What nativeBridge.ts and nativeBridge.native.ts both export.

export const NATIVE_DEEP_LINK_EVENT = "linky-native-deep-link";
export const NATIVE_NOTIFICATION_OPEN_EVENT = "linky-native-notification-open";
export const NATIVE_PUSH_ACTION_EVENT = "linky-native-push-action";
export const NATIVE_RESUME_EVENT = "linky-native-resume";

export const BeaconPermissionState = Schema.Literals([
  "granted",
  "denied",
  "prompt",
  "unsupported",
]);
export type BeaconPermissionState = typeof BeaconPermissionState.Type;

export const NativeBeaconStatus = Schema.Struct({
  running: Schema.Boolean,
  bluetoothOn: Schema.Boolean,
  advertising: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type NativeBeaconStatus = typeof NativeBeaconStatus.Type;
