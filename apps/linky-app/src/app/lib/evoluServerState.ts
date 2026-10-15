import type {
  ConnectionState,
  EvoluSyncState,
} from "../../utils/connectionStatus";

interface DeriveEvoluServerStateOptions {
  evoluHasError: boolean;
  isOffline: boolean;
  state: ConnectionState | undefined;
  /** The app owner the store syncs; null before the session has one. */
  syncOwnerId: string | null;
}

export function deriveEvoluServerState({
  evoluHasError,
  isOffline,
  state,
  syncOwnerId,
}: DeriveEvoluServerStateOptions): EvoluSyncState {
  if (isOffline) return "offline";
  if (state === "connected") {
    return syncOwnerId && !evoluHasError ? "synced" : "notSynced";
  }
  return state === "disconnected" ? "unreachable" : "syncing";
}
