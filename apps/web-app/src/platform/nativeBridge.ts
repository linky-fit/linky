import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import {
  getPlatformTarget,
  getTelemetryDevicePlatform,
  isNativePlatform,
} from "./runtime";
import { isRecord } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";

type NativeNotificationPermissionState =
  | "denied"
  | "granted"
  | "prompt"
  | "unsupported";

type NativeScanResult = {
  cancelled: boolean;
  message?: string;
  value: string | null;
};

interface NativeBridgeRequestOptions<Result> {
  eventName: string;
  failure?: (error: unknown) => Result;
  fallback: Result;
  invoke: () => boolean | void;
  parse: (event: Event) => Result | null;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface NativeScanStreamHandle {
  stop: () => void;
}

interface IosScannerPluginResult {
  cancelled?: boolean;
  message?: string | null;
  value?: string | null;
}

interface IosScannerPlugin {
  scan(): Promise<IosScannerPluginResult>;
}

const LinkyScanner = registerPlugin<IosScannerPlugin>("LinkyScanner");

interface IosNfcSupportResult {
  supported?: boolean;
}

interface IosNfcPluginResult {
  message?: string | null;
  status?: string | null;
}

interface IosNfcDeepLinkResult {
  url?: string | null;
}

interface IosNfcDeepLinkEvent {
  url?: string | null;
}

interface IosNfcPlugin {
  addListener?(
    eventName: "deepLink",
    listenerFunc: (event: IosNfcDeepLinkEvent) => void,
  ): Promise<PluginListenerHandle>;
  areSupported(): Promise<IosNfcSupportResult>;
  consumePendingDeepLinkUrl(): Promise<IosNfcDeepLinkResult>;
  cancelWrite(): Promise<void>;
  writeUri(options: { url: string }): Promise<IosNfcPluginResult>;
}

const LinkyNfc = registerPlugin<IosNfcPlugin>("LinkyNfc");

interface AndroidSecretStorageBridge {
  get?: (key: string) => string | null;
  remove?: (key: string) => void;
  set?: (key: string, value: string) => void;
}

interface AndroidScannerBridge {
  setScanViewport?: (
    leftCssPx: number,
    topCssPx: number,
    widthCssPx: number,
    heightCssPx: number,
    viewportWidthCssPx: number,
    viewportHeightCssPx: number,
  ) => void;
  startScan?: () => void;
  stopScan?: () => void;
}

export interface NativeScanViewport {
  height: number;
  left: number;
  top: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
}

const NATIVE_SCAN_VIEWPORT_MAX_FRAMES = 30;

interface AndroidNotificationsBridge {
  areSupported?: () => boolean;
  getPermissionState?: () => string;
  requestPermission?: () => void;
}

interface AndroidWindowInsetsBridge {
  getBottomInsetPx?: () => number | string;
  getKeyboardInsetPx?: () => number | string;
  getTopInsetPx?: () => number | string;
}

interface AndroidDeepLinksBridge {
  consumePendingNotificationOpenDetail?: () => string | null;
  consumePendingNotificationRoute?: () => string | null;
  consumePendingUrl?: () => string | null;
}

interface AndroidNfcBridge {
  areSupported?: () => boolean;
  cancelWrite?: () => void;
  writeUri?: (url: string) => void;
}

export const NATIVE_DEEP_LINK_EVENT = "linky-native-deep-link";
const NATIVE_NFC_WRITE_EVENT = "linky-native-nfc-write";
export const NATIVE_NOTIFICATION_OPEN_EVENT = "linky-native-notification-open";
export const NATIVE_PUSH_ACTION_EVENT = "linky-native-push-action";

type NativeNfcWriteStatus =
  | "armed"
  | "busy"
  | "cancelled"
  | "disabled"
  | "error"
  | "success"
  | "unsupported";

interface NativeNfcWriteResult {
  message: string | null;
  prompt?: "web";
  status: NativeNfcWriteStatus;
}

const parseNativeScanResultEvent = (event: Event): NativeScanResult | null => {
  if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
    return null;
  }

  const status = asNonEmptyString(Reflect.get(event.detail, "status"));
  const value = asNonEmptyString(Reflect.get(event.detail, "value"));
  const message = asNonEmptyString(Reflect.get(event.detail, "message"));

  if (status === "success" && value) {
    return message === null
      ? { cancelled: false, value }
      : { cancelled: false, message, value };
  }

  if (status !== "cancelled" && status !== "error" && status !== "success") {
    return null;
  }

  return message === null
    ? { cancelled: status !== "error", value: null }
    : { cancelled: status !== "error", message, value: null };
};

const requestNativeBridgeEvent = <Result>({
  eventName,
  failure,
  fallback,
  invoke,
  parse,
  signal,
  timeoutMs,
}: NativeBridgeRequestOptions<Result>): Promise<Result> => {
  return new Promise<Result>((resolve) => {
    let settled = false;

    const finish = (result: Result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onResult: EventListener = (event) => {
      finish(parse(event) ?? fallback);
    };

    const onAbort = () => {
      finish(fallback);
    };

    const timeoutId = window.setTimeout(() => {
      finish(fallback);
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(eventName, onResult);
      signal?.removeEventListener("abort", onAbort);
    };

    window.addEventListener(eventName, onResult);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      finish(fallback);
      return;
    }

    try {
      if (invoke() === false) {
        finish(fallback);
      }
    } catch (error) {
      finish(failure?.(error) ?? fallback);
    }
  });
};

const getAndroidSecretStorageBridge = (): AndroidSecretStorageBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeSecretStorage");
  return isRecord(value) ? value : null;
};

const getAndroidScannerBridge = (): AndroidScannerBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeScanner");
  return isRecord(value) ? value : null;
};

const getAndroidNotificationsBridge = (): AndroidNotificationsBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeNotifications");
  return isRecord(value) ? value : null;
};

const getAndroidWindowInsetsBridge = (): AndroidWindowInsetsBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeWindowInsets");
  return isRecord(value) ? value : null;
};

const getAndroidDeepLinksBridge = (): AndroidDeepLinksBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeDeepLinks");
  return isRecord(value) ? value : null;
};

const getAndroidNfcBridge = (): AndroidNfcBridge | null => {
  const value = Reflect.get(globalThis, "LinkyNativeNfc");
  return isRecord(value) ? value : null;
};

const isNativeNfcWriteStatus = (
  value: string | null,
): value is NativeNfcWriteStatus => {
  return (
    value === "armed" ||
    value === "busy" ||
    value === "cancelled" ||
    value === "disabled" ||
    value === "error" ||
    value === "success" ||
    value === "unsupported"
  );
};

const supportsIosNativeQrScan = (): boolean => {
  return (
    getPlatformTarget() === "ios" && Capacitor.isPluginAvailable("LinkyScanner")
  );
};

const supportsIosNativeNfcWrite = (): boolean => {
  return (
    getPlatformTarget() === "ios" && Capacitor.isPluginAvailable("LinkyNfc")
  );
};

export const readAndroidStoredSecret = async (
  key: string,
): Promise<string | null | undefined> => {
  const bridge = getAndroidSecretStorageBridge();
  if (!bridge?.get) {
    return undefined;
  }

  return asNonEmptyString(bridge.get(key));
};

export const writeAndroidStoredSecret = async (
  key: string,
  value: string,
): Promise<boolean> => {
  const bridge = getAndroidSecretStorageBridge();
  if (!bridge?.set) {
    return false;
  }

  bridge.set(key, value);
  return true;
};

export const removeAndroidStoredSecret = async (
  key: string,
): Promise<boolean> => {
  const bridge = getAndroidSecretStorageBridge();
  if (!bridge?.remove) {
    return false;
  }

  bridge.remove(key);
  return true;
};

export const supportsNativeQrScan = (): boolean => {
  if (supportsIosNativeQrScan()) {
    return true;
  }

  return isNativePlatform() && Boolean(getAndroidScannerBridge()?.startScan);
};

const normalizeInsetPx = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const nativePxToCssPx = (value: number): number => {
  if (typeof window === "undefined") {
    return value;
  }

  const dpr = window.devicePixelRatio;
  if (!Number.isFinite(dpr) || dpr <= 0) {
    return value;
  }

  return Math.round((value / dpr) * 100) / 100;
};

const applyNativeSafeAreaInsets = () => {
  if (typeof document === "undefined") return;

  const bridge = getAndroidWindowInsetsBridge();
  const rootStyle = document.documentElement.style;

  const topInset = normalizeInsetPx(bridge?.getTopInsetPx?.());
  const bottomInset = normalizeInsetPx(bridge?.getBottomInsetPx?.());
  const keyboardInset = normalizeInsetPx(bridge?.getKeyboardInsetPx?.());

  if (topInset !== null) {
    rootStyle.setProperty("--safe-area-top", `${nativePxToCssPx(topInset)}px`);
  }

  if (bottomInset !== null) {
    rootStyle.setProperty(
      "--safe-area-bottom",
      `${nativePxToCssPx(bottomInset)}px`,
    );
  }

  if (keyboardInset !== null) {
    rootStyle.setProperty(
      "--native-keyboard-inset",
      `${nativePxToCssPx(keyboardInset)}px`,
    );
  }
};

if (typeof window !== "undefined") {
  const applyInsets = () => {
    applyNativeSafeAreaInsets();
  };

  applyInsets();
  window.addEventListener("linky-native-window-insets", applyInsets);
  window.addEventListener("resize", applyInsets);
  window.addEventListener("orientationchange", applyInsets);

  if (supportsIosNativeNfcWrite() && LinkyNfc.addListener) {
    void LinkyNfc.addListener("deepLink", (event) => {
      const url = asNonEmptyString(event.url);
      if (!url) return;

      window.dispatchEvent(
        new CustomEvent(NATIVE_DEEP_LINK_EVENT, {
          detail: { url },
        }),
      );
    }).catch(() => undefined);
  }
}

export const startNativeQrScan = (): Promise<NativeScanResult> | null => {
  if (supportsIosNativeQrScan()) {
    return LinkyScanner.scan().then((result) => {
      const value = asNonEmptyString(result.value);
      const message = asNonEmptyString(result.message);
      const cancelled = result.cancelled === true;

      return message === null
        ? { cancelled, value }
        : { cancelled, message, value };
    });
  }

  const bridge = getAndroidScannerBridge();
  if (!isNativePlatform() || !bridge?.startScan) {
    return null;
  }

  return requestNativeBridgeEvent({
    eventName: "linky-native-scan-result",
    failure: (error) => ({
      cancelled: false,
      message: String(error ?? "Native scanner failed"),
      value: null,
    }),
    fallback: { cancelled: true, value: null },
    invoke: () => {
      if (!bridge.startScan) return false;
      bridge.startScan();
      return true;
    },
    parse: parseNativeScanResultEvent,
    timeoutMs: 2 * 60 * 1000,
  });
};

export const startNativeQrScanStream = (
  onResult: (result: NativeScanResult) => void,
  getViewport?: () => NativeScanViewport | null,
): NativeScanStreamHandle | null => {
  if (supportsIosNativeQrScan()) {
    return null;
  }

  const bridge = getAndroidScannerBridge();
  if (!isNativePlatform() || !bridge?.startScan) {
    return null;
  }

  const eventName = "linky-native-scan-result";

  const onResultEvent: EventListener = (event) => {
    const result = parseNativeScanResultEvent(event);
    if (result) onResult(result);
  };

  let animationFrameId: number | null = null;
  let started = false;

  const cleanup = () => {
    window.removeEventListener(eventName, onResultEvent);
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  window.addEventListener(eventName, onResultEvent);

  const startWhenViewportIsReady = (framesRemaining: number) => {
    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = null;

      try {
        const viewport = getViewport?.() ?? null;
        if (
          !viewport &&
          getViewport &&
          bridge.setScanViewport &&
          framesRemaining > 1
        ) {
          startWhenViewportIsReady(framesRemaining - 1);
          return;
        }

        // Viewport still unavailable after the frame budget: start anyway so a
        // slow layout degrades to a full-screen preview instead of no scanner.
        if (viewport && bridge.setScanViewport) {
          bridge.setScanViewport(
            viewport.left,
            viewport.top,
            viewport.width,
            viewport.height,
            viewport.viewportWidth,
            viewport.viewportHeight,
          );
        }
        bridge.startScan?.();
        started = true;
      } catch (error) {
        cleanup();
        onResult({
          cancelled: false,
          message: String(error ?? "Native scanner failed"),
          value: null,
        });
      }
    });
  };

  startWhenViewportIsReady(NATIVE_SCAN_VIEWPORT_MAX_FRAMES);

  return {
    stop: () => {
      cleanup();
      if (started) {
        try {
          bridge.stopScan?.();
        } catch {
          // ignore native scanner shutdown failures
        }
      }
    },
  };
};

export const getNativeNotificationPermissionState =
  (): NativeNotificationPermissionState | null => {
    const bridge = getAndroidNotificationsBridge();
    if (!isNativePlatform() || !bridge?.areSupported?.()) {
      return null;
    }

    const rawState = asNonEmptyString(bridge.getPermissionState?.());
    if (
      rawState === "denied" ||
      rawState === "granted" ||
      rawState === "prompt" ||
      rawState === "unsupported"
    ) {
      return rawState;
    }

    return "unsupported";
  };

export const requestNativeNotificationPermission = async (): Promise<
  boolean | null
> => {
  const bridge = getAndroidNotificationsBridge();
  if (
    !isNativePlatform() ||
    !bridge?.areSupported?.() ||
    !bridge.requestPermission
  ) {
    return null;
  }

  const currentState = getNativeNotificationPermissionState();
  if (currentState === "granted") {
    return true;
  }

  return requestNativeBridgeEvent({
    eventName: "linky-native-notification-permission",
    fallback: false,
    invoke: () => {
      if (!bridge.requestPermission) return false;
      bridge.requestPermission();
      return true;
    },
    parse: (event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
        return null;
      }

      const permission = asNonEmptyString(
        Reflect.get(event.detail, "permission"),
      );
      if (
        permission !== "denied" &&
        permission !== "granted" &&
        permission !== "prompt" &&
        permission !== "unsupported"
      ) {
        return null;
      }

      return permission === "granted";
    },
    timeoutMs: 30_000,
  });
};

export const supportsNativeNfcWrite = (): boolean => {
  if (supportsIosNativeNfcWrite()) {
    return true;
  }

  const bridge = getAndroidNfcBridge();
  if (!isNativePlatform() || !bridge?.areSupported) {
    return false;
  }

  try {
    return bridge.areSupported();
  } catch {
    return false;
  }
};

export const shouldRenderNativeNfcWritePrompt = (): boolean => {
  const devicePlatform = getTelemetryDevicePlatform();
  if (
    getPlatformTarget() === "ios" ||
    devicePlatform === "iphone" ||
    devicePlatform === "ipad"
  ) {
    return false;
  }

  const bridge = getAndroidNfcBridge();
  return isNativePlatform() && Boolean(bridge?.writeUri);
};

export const startNativeNfcWrite = async (
  url: string,
  onProgress?: (result: NativeNfcWriteResult) => void,
): Promise<NativeNfcWriteResult | null> => {
  if (supportsIosNativeNfcWrite()) {
    try {
      const supportResult = await LinkyNfc.areSupported();
      if (supportResult.supported !== true) {
        return null;
      }

      const result = await LinkyNfc.writeUri({ url });
      const status = asNonEmptyString(result.status);

      if (!isNativeNfcWriteStatus(status) || status === "armed") {
        return {
          message: asNonEmptyString(result.message),
          status: "error",
        };
      }

      return {
        message: asNonEmptyString(result.message),
        status,
      };
    } catch (error) {
      return {
        message: String(error ?? "Native NFC write failed"),
        status: "error",
      };
    }
  }

  const bridge = getAndroidNfcBridge();
  if (!isNativePlatform() || !bridge?.areSupported || !bridge.writeUri) {
    return null;
  }

  if (!bridge.areSupported()) {
    return null;
  }

  return new Promise<NativeNfcWriteResult>((resolve) => {
    const onResult: EventListener = (event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
        return;
      }

      const rawStatus = asNonEmptyString(Reflect.get(event.detail, "status"));
      if (!isNativeNfcWriteStatus(rawStatus)) {
        return;
      }

      const result: NativeNfcWriteResult = {
        message: asNonEmptyString(Reflect.get(event.detail, "message")),
        status: rawStatus,
      };

      if (result.status === "armed") {
        onProgress?.(
          shouldRenderNativeNfcWritePrompt()
            ? {
                ...result,
                prompt: "web",
              }
            : result,
        );
        return;
      }

      cleanup();
      resolve(result);
    };

    const cleanup = () => {
      window.removeEventListener(NATIVE_NFC_WRITE_EVENT, onResult);
    };

    window.addEventListener(NATIVE_NFC_WRITE_EVENT, onResult);

    try {
      bridge.writeUri?.(url);
    } catch (error) {
      cleanup();
      resolve({
        message: String(error ?? "Native NFC write failed"),
        status: "error",
      });
    }
  });
};

export const cancelNativeNfcWrite = (): boolean => {
  if (supportsIosNativeNfcWrite()) {
    void LinkyNfc.cancelWrite().catch(() => undefined);
    return true;
  }

  const bridge = getAndroidNfcBridge();
  if (!isNativePlatform() || !bridge?.cancelWrite) {
    return false;
  }

  try {
    bridge.cancelWrite();
    return true;
  } catch {
    return false;
  }
};

export const consumePendingNativeDeepLinkUrl = (): string | null => {
  const bridge = getAndroidDeepLinksBridge();
  if (!isNativePlatform() || !bridge?.consumePendingUrl) {
    return null;
  }

  try {
    return asNonEmptyString(bridge.consumePendingUrl());
  } catch {
    return null;
  }
};

export const consumePendingNativeNotificationRoute = (): string | null => {
  const bridge = getAndroidDeepLinksBridge();
  if (!isNativePlatform() || !bridge?.consumePendingNotificationRoute) {
    return null;
  }

  try {
    return asNonEmptyString(bridge.consumePendingNotificationRoute());
  } catch {
    return null;
  }
};

export const consumePendingNativeNotificationOpenDetail = (): string | null => {
  const bridge = getAndroidDeepLinksBridge();
  if (!isNativePlatform() || !bridge?.consumePendingNotificationOpenDetail) {
    return null;
  }

  try {
    return asNonEmptyString(bridge.consumePendingNotificationOpenDetail());
  } catch {
    return null;
  }
};

export const consumePendingIosNativeDeepLinkUrl = async (): Promise<
  string | null
> => {
  if (!supportsIosNativeNfcWrite()) {
    return null;
  }

  try {
    const result = await LinkyNfc.consumePendingDeepLinkUrl();
    return asNonEmptyString(result.url);
  } catch {
    return null;
  }
};
