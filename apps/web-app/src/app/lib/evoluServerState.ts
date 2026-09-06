import type { SyncOwner } from "@evolu/common";

type EvoluServerConnectionState = "connected" | "checking" | "disconnected";

interface DeriveEvoluServerStateOptions {
  evoluHasError: boolean;
  isOffline: boolean;
  state: EvoluServerConnectionState | undefined;
  syncOwner: SyncOwner | null;
}

export function deriveEvoluServerState({
  evoluHasError,
  isOffline,
  state,
  syncOwner,
}: DeriveEvoluServerStateOptions): {
  state: EvoluServerConnectionState;
  isSynced: boolean;
  labelKey:
    | "evoluNotSynced"
    | "evoluServerOfflineStatus"
    | "evoluSyncing"
    | "evoluSyncOk";
} {
  const resolvedState = isOffline ? "disconnected" : (state ?? "checking");
  const isSynced =
    Boolean(syncOwner) &&
    !evoluHasError &&
    !isOffline &&
    resolvedState === "connected";
  const labelKey = isOffline
    ? "evoluServerOfflineStatus"
    : isSynced
      ? "evoluSyncOk"
      : resolvedState === "checking"
        ? "evoluSyncing"
        : "evoluNotSynced";

  return { state: resolvedState, isSynced, labelKey };
}
