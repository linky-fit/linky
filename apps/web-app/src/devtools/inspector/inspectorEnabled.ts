import React from "react";

import { clientInspectorStore } from "./clientInspectorStore";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../utils/storage";

const INSPECTOR_ENABLED_STORAGE_KEY = "linky.inspector_enabled";
const INSPECTOR_LOGS_ENABLED_STORAGE_KEY = "linky.inspector_logs_enabled";

const readPreference = (key: string): boolean | null => {
  const stored = safeLocalStorageGet(key);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
};

let preference = readPreference(INSPECTOR_ENABLED_STORAGE_KEY);
let logsPreference =
  readPreference(INSPECTOR_LOGS_ENABLED_STORAGE_KEY) ?? false;
const listeners = new Set<() => void>();
const logsListeners = new Set<() => void>();

export const resolveInspectorEnabled = (
  storedPreference: boolean | null,
  isDev: boolean,
): boolean => storedPreference ?? isDev;

export const getInspectorEnabled = (): boolean =>
  resolveInspectorEnabled(preference, import.meta.env.DEV);

export const getInspectorLogsEnabled = (): boolean => logsPreference;

export const resolveInspectorEmissionEnabled = (
  isDev: boolean,
  liveEnabled: boolean,
  logsEnabled: boolean,
): boolean => isDev || liveEnabled || logsEnabled;

export const getInspectorEmissionEnabled = (): boolean =>
  resolveInspectorEmissionEnabled(
    import.meta.env.DEV,
    getInspectorEnabled(),
    getInspectorLogsEnabled(),
  );

export const setInspectorEnabled = (enabled: boolean): void => {
  const changed = preference !== enabled;
  preference = enabled;
  safeLocalStorageSet(INSPECTOR_ENABLED_STORAGE_KEY, String(enabled));

  if (!enabled) clientInspectorStore.clear();
  if (changed) {
    for (const listener of listeners) listener();
  }
};

export const setInspectorLogsEnabled = (enabled: boolean): void => {
  const changed = logsPreference !== enabled;
  logsPreference = enabled;
  safeLocalStorageSet(INSPECTOR_LOGS_ENABLED_STORAGE_KEY, String(enabled));

  if (!enabled) {
    void import("./persistentInspectorLogSink")
      .then(({ clearPersistentInspectorLogs }) =>
        clearPersistentInspectorLogs(),
      )
      .catch(() => undefined);
  }
  if (changed) {
    for (const listener of logsListeners) listener();
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const subscribeLogs = (listener: () => void): (() => void) => {
  logsListeners.add(listener);
  return () => logsListeners.delete(listener);
};

export const useInspectorEnabled = (): boolean =>
  React.useSyncExternalStore(subscribe, getInspectorEnabled, () => false);

export const useInspectorLogsEnabled = (): boolean =>
  React.useSyncExternalStore(
    subscribeLogs,
    getInspectorLogsEnabled,
    () => false,
  );

export const useInspectorEmissionEnabled = (): boolean => {
  const inspectorEnabled = useInspectorEnabled();
  const inspectorLogsEnabled = useInspectorLogsEnabled();
  return resolveInspectorEmissionEnabled(
    import.meta.env.DEV,
    inspectorEnabled,
    inspectorLogsEnabled,
  );
};
