type EvoluServerConnectionState = "connected" | "checking" | "disconnected";

interface DeriveEvoluServerStateOptions {
  evoluHasError: boolean;
  isOffline: boolean;
  state: EvoluServerConnectionState | undefined;
  /** The app owner the store syncs; null before the session has one. */
  syncOwnerId: string | null;
}

export function deriveEvoluServerState({
  evoluHasError,
  isOffline,
  state,
  syncOwnerId,
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
    Boolean(syncOwnerId) &&
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
