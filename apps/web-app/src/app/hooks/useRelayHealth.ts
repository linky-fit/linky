import type { RelayHealthState } from "@linky-fit/linkstr";
import {
  relayHealthAtom,
  AsyncResult,
  useAtomValue,
} from "@linky-fit/linkstr-react";

export type RelayDotState = "checking" | "connected" | "disconnected";

const EMPTY_HEALTH: ReadonlyMap<string, RelayHealthState> = new Map();

/** Traffic-derived relay health from linkstr; empty while logged out. */
export const useRelayHealth = (): ReadonlyMap<string, RelayHealthState> => {
  const result = useAtomValue(relayHealthAtom);
  return AsyncResult.isSuccess(result) ? result.value : EMPTY_HEALTH;
};

export const relayDotState = (
  health: RelayHealthState | undefined,
): RelayDotState => {
  if (health === undefined || health.state === "connecting") return "checking";
  return health.state === "connected" ? "connected" : "disconnected";
};

export const countConnectedRelays = (
  relayUrls: readonly string[],
  health: ReadonlyMap<string, RelayHealthState>,
): number =>
  relayUrls.filter((url) => health.get(url)?.state === "connected").length;

export const overallRelayStatus = (
  relayUrls: readonly string[],
  health: ReadonlyMap<string, RelayHealthState>,
): RelayDotState => {
  if (relayUrls.length === 0) return "disconnected";
  if (countConnectedRelays(relayUrls, health) > 0) return "connected";
  return relayUrls.some((url) => relayDotState(health.get(url)) === "checking")
    ? "checking"
    : "disconnected";
};
