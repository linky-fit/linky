import type { Pubkey } from "@linky-fit/linkstr";
import type { ColorMode } from "@linky-fit/ui/tokens";
import { setStatusBarStyle } from "expo-status-bar";
import type {
  BeaconPermissionState,
  NativeBeaconStatus,
} from "./nativeBridgeShared";

// The Capacitor shells' bridges. The Expo app has none of them yet: the
// scanner, deep links, push, NFC and the beacon answer "unsupported".

export {
  BeaconPermissionState,
  NATIVE_DEEP_LINK_EVENT,
  NATIVE_NOTIFICATION_OPEN_EVENT,
  NATIVE_PUSH_ACTION_EVENT,
  NATIVE_RESUME_EVENT,
  NativeBeaconStatus,
} from "./nativeBridgeShared";

interface NativeScanResult {
  cancelled: boolean;
  message?: string;
  value: string | null;
}

export interface NativeScanStreamHandle {
  updateViewport: () => void;
  stop: () => void;
}

export interface NativeScanViewport {
  height: number;
  left: number;
  top: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
}

interface NativeNfcWriteResult {
  message: string | null;
  prompt?: "web";
  status:
    | "armed"
    | "busy"
    | "cancelled"
    | "disabled"
    | "error"
    | "success"
    | "unsupported";
}

export type NativePushTransport = "fcm" | "unifiedpush";

export type UnifiedPushRegistration =
  | {
      readonly status: "endpoint";
      readonly endpoint: string;
      readonly p256dh: string;
      readonly auth: string;
    }
  | { readonly status: "failed"; readonly reason: string };

export type NativeBeaconTrade = "buy" | "sell" | "none";

export interface NativeBeaconSighting {
  readonly pubkey: Pubkey;
  readonly state: "nearby" | "buy" | "sell";
  readonly lastSeenMs: number;
}

export interface NativeBeaconKey {
  readonly pubkey: Pubkey;
  readonly beaconKeyHex: string;
  readonly priority: number;
  readonly name: string;
}

const unsubscribed = () => () => {};

export const readAndroidStoredSecret: (
  key: string,
) => Promise<string | null | undefined> = async () => undefined;
export const writeAndroidStoredSecret: (
  key: string,
  value: string,
) => Promise<boolean> = async () => false;
export const removeAndroidStoredSecret: (
  key: string,
) => Promise<boolean> = async () => false;

/** Deep links reach the app through expo-linking (P6). */
export const onNativeDeepLinkUrl: (onUrl: (url: string) => void) => () => void =
  unsubscribed;
export const onNativeNotificationOpen: (
  onDetail: (detail: object) => void,
) => () => void = unsubscribed;

export const supportsNativeQrScan = (): boolean => false;
export const startNativeQrScan = (): Promise<NativeScanResult> | null => null;
export const startNativeQrScanStream: (
  onResult: (result: NativeScanResult) => void,
  getViewport?: () => NativeScanViewport | null,
) => NativeScanStreamHandle | null = () => null;

/** Makes the status bar icons readable on the app background in `mode`. */
export const setNativeStatusBarColorMode = (mode: ColorMode): void =>
  setStatusBarStyle(mode === "dark" ? "light" : "dark");

export const getNativeNotificationPermissionState = (): null => null;
export const requestNativeNotificationPermission = async (): Promise<
  boolean | null
> => null;
export const getNativePushTransport = (): NativePushTransport => "fcm";
export const requestNativeUnifiedPushEndpoint: (
  vapidPublicKey: string,
) => Promise<UnifiedPushRegistration> = async () => ({
  status: "failed",
  reason: "UNSUPPORTED",
});
export const unregisterNativeUnifiedPush = (): void => {};

export const supportsNativeNfcWrite = (): boolean => false;
export const shouldRenderNativeNfcWritePrompt = (): boolean => false;
export const startNativeNfcWrite: (
  url: string,
  onProgress?: (result: NativeNfcWriteResult) => void,
) => Promise<NativeNfcWriteResult | null> = async () => null;
export const cancelNativeNfcWrite = (): boolean => false;

export const readNativeBuiltinRuntimeFile = (): string | null => null;
export const consumePendingNativeDeepLinkUrl = (): string | null => null;
export const consumePendingNativeNotificationRoute = (): string | null => null;
export const consumePendingNativeNotificationOpenDetail = (): string | null =>
  null;
export const consumePendingIosNativeDeepLinkUrl = async (): Promise<
  string | null
> => null;

export const getNativeBeaconPermissionState = (): BeaconPermissionState =>
  "unsupported";
export const takeNativeBeaconStoppedByUser = (): boolean => false;
export const requestNativeBeaconPermissions = (): boolean => false;
export const setNativeBeaconKeys: (
  keys: ReadonlyArray<NativeBeaconKey>,
) => boolean = () => false;
export const setNativeBeaconIdentity: (pubkey: Pubkey) => boolean = () => false;
export const setNativeBeaconTrade: (trade: NativeBeaconTrade) => boolean = () =>
  false;
export const startNativeBeacon = (): boolean => false;
export const stopNativeBeacon = (): boolean => false;
export const startNativeBeaconIdentityScan = (): boolean => false;
export const stopNativeBeaconIdentityScan = (): boolean => false;
export const onNativeBeaconPermission: (
  listener: (state: BeaconPermissionState) => void,
) => () => void = unsubscribed;
export const onNativeBeaconStatus: (
  listener: (status: NativeBeaconStatus) => void,
) => () => void = unsubscribed;
export const onNativeBeaconNearby: (
  listener: (contacts: ReadonlyArray<NativeBeaconSighting>) => void,
) => () => void = unsubscribed;
export const onNativeBeaconIdentities: (
  listener: (pubkeys: ReadonlyArray<Pubkey>) => void,
) => () => void = unsubscribed;
export const onNativeBeaconOpenConversation: (
  listener: (pubkey: Pubkey) => void,
) => () => void = unsubscribed;
