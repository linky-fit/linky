type EvoluRelayConnectionState = "connected" | "checking" | "disconnected";

interface DeriveEvoluRelayStateOptions {
  evoluHasError: boolean;
  isOffline: boolean;
  state: EvoluRelayConnectionState | undefined;
  /** The app owner the store syncs; null before the session has one. */
  syncOwnerId: string | null;
}

export function deriveEvoluRelayState({
  evoluHasError,
  isOffline,
  state,
  syncOwnerId,
}: DeriveEvoluRelayStateOptions): {
  state: EvoluRelayConnectionState;
  isSynced: boolean;
  labelKey:
    | "evoluNotSynced"
    | "evoluRelayOfflineStatus"
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
    ? "evoluRelayOfflineStatus"
    : isSynced
      ? "evoluSyncOk"
      : resolvedState === "checking"
        ? "evoluSyncing"
        : "evoluNotSynced";

  return { state: resolvedState, isSynced, labelKey };
}
