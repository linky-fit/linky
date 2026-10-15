import type { Tone } from "@linky-fit/ui";
import type { I18nKey } from "../i18n";

interface StatusStyle {
  tone: Tone;
  labelKey: I18nKey;
}

export type ConnectionState = "connected" | "checking" | "disconnected";

/** Status dot tone and label of a relay or Evolu server connection. */
export const connectionStatus = {
  connected: { tone: "accent", labelKey: "relayStateConnected" },
  checking: { tone: "warning", labelKey: "relayStateConnecting" },
  disconnected: { tone: "danger", labelKey: "relayStateUnreachable" },
} as const satisfies Record<ConnectionState, StatusStyle>;

export type EvoluSyncState =
  | "synced"
  | "syncing"
  | "notSynced"
  | "unreachable"
  | "offline";

/** Status dot tone and label of one Evolu server's sync. */
export const evoluSyncStatus = {
  synced: { tone: "accent", labelKey: "evoluSyncOk" },
  syncing: { tone: "warning", labelKey: "evoluSyncing" },
  notSynced: { tone: "warning", labelKey: "evoluNotSynced" },
  unreachable: { tone: "danger", labelKey: "evoluNotSynced" },
  offline: { tone: "neutral", labelKey: "evoluServerOfflineStatus" },
} as const satisfies Record<EvoluSyncState, StatusStyle>;
