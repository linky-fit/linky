import * as Network from "expo-network";
import { AppState, BackHandler } from "react-native";
import { reloadApp } from "./reload";

type Unsubscribe = () => void;

// Unknown until expo-network first answers, and counted as online meanwhile.
let connected: boolean | undefined;
const connectivityListeners = new Set<(online: boolean) => void>();

const applyNetworkState = ({ isConnected }: Network.NetworkState): void => {
  const online = isConnected !== false;
  const changed = (connected ?? true) !== online;
  connected = online;
  if (changed) for (const listener of connectivityListeners) listener(online);
};

Network.addNetworkStateListener(applyNetworkState);
void Network.getNetworkStateAsync().then(applyNetworkState, () => undefined);

/** False only while the device reports no network connection. */
export const isOnline = (): boolean => connected !== false;

/** Calls `callback` with the new state whenever the network connection comes or goes. */
export const onConnectivityChange = (
  callback: (online: boolean) => void,
): Unsubscribe => {
  connectivityListeners.add(callback);
  return () => connectivityListeners.delete(callback);
};

/** Calls `callback` whenever the device regains a network connection. */
export const onOnline = (callback: () => void): Unsubscribe =>
  onConnectivityChange((online) => {
    if (online) callback();
  });

/** Whether the app is in the foreground. */
export const isAppVisible = (): boolean => AppState.currentState === "active";

/** Calls `callback` whenever the app moves to the foreground or the background. */
export const onVisibilityChange = (callback: () => void): Unsubscribe => {
  let visible = isAppVisible();
  const subscription = AppState.addEventListener("change", () => {
    if (isAppVisible() === visible) return;
    visible = isAppVisible();
    callback();
  });
  return () => subscription.remove();
};

/** Calls `callback` whenever the app returns to the foreground. */
export const onAppResume = (callback: () => void): Unsubscribe =>
  onVisibilityChange(() => {
    if (isAppVisible()) callback();
  });

/**
 * Offers the system back press to `handler`, which returns true when it
 * handled the press. An unhandled press runs the default, closing the app.
 */
export const onBackPress = (handler: () => boolean): Unsubscribe => {
  const subscription = BackHandler.addEventListener(
    "hardwareBackPress",
    handler,
  );
  return () => subscription.remove();
};

/** Boot progress the web page shell listens for. */
export type AppEvent =
  | "linky-app-mounted"
  | "linky-boot-decision-pending"
  | "linky-boot-decision-resolved"
  | "linky-boot-failed"
  | "linky-clear-cache-and-reload";

/** The native app has no page shell; the crash screen's recovery reloads. */
export const emitAppEvent = (event: AppEvent): void => {
  if (event === "linky-clear-cache-and-reload") reloadApp();
};
