import {
  inboxBackfillingAtom,
  linkstrConfigAtom,
  Result,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import type { EvoluRelayStatus } from "@linky-fit/linksync/evolu";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { EVOLU_SERVER_URLS, useEvoluRelayStatuses } from "../../evolu";
import { useOnline } from "../../hooks/useOnline";
import { useAccountHydrated } from "./useLinksync";
import { overallRelayStatus, useRelayHealth } from "./useRelayHealth";
import type { RelayDotState } from "./useRelayHealth";

export type NetworkStatus = "offline" | "syncing" | "synced";

/** Leaving "synced" waits this long, so a short sync round or reconnect does not flash the dot. */
const UNSETTLED_AFTER_MS = 1_000;

const severity: Record<NetworkStatus, number> = {
  synced: 0,
  syncing: 1,
  offline: 2,
};

const evoluStatus = (
  relays: ReadonlyArray<EvoluRelayStatus | undefined>,
  hydrated: boolean,
): NetworkStatus => {
  if (relays.some((status) => status === "syncing" || status === "synced"))
    return hydrated && !relays.includes("syncing") ? "synced" : "syncing";
  return relays.some(
    (status) => status === undefined || status === "connecting",
  )
    ? "syncing"
    : "offline";
};

const nostrStatus = (
  relays: RelayDotState,
  backfilling: boolean,
): NetworkStatus => {
  if (relays === "disconnected") return "offline";
  return relays === "checking" || backfilling ? "syncing" : "synced";
};

interface NetworkInputs {
  online: boolean;
  evoluRelays: ReadonlyArray<EvoluRelayStatus | undefined>;
  hydrated: boolean;
  nostrRelays: RelayDotState;
  backfilling: boolean;
}

/** The worse of Evolu and Nostr: offline when either reaches no relay, syncing while either still delivers stored data. */
export const deriveNetworkStatus = ({
  online,
  evoluRelays,
  hydrated,
  nostrRelays,
  backfilling,
}: NetworkInputs): NetworkStatus => {
  if (!online) return "offline";
  const evolu = evoluStatus(evoluRelays, hydrated);
  const nostr = nostrStatus(nostrRelays, backfilling);
  return severity[evolu] >= severity[nostr] ? evolu : nostr;
};

/** Whether the device reaches its Evolu and Nostr relays and has received what they hold. */
export const useNetworkStatus = (): NetworkStatus => {
  const online = useOnline();
  const evoluStatuses = useEvoluRelayStatuses();
  const hydrated = useAccountHydrated();
  const readRelays = useAtomValue(linkstrConfigAtom)?.readRelays ?? [];
  const relayHealth = useRelayHealth();
  const backfillingResult = useAtomValue(inboxBackfillingAtom);

  const inputs: NetworkInputs = {
    online,
    evoluRelays: EVOLU_SERVER_URLS.map((url) => evoluStatuses[url]),
    hydrated,
    nostrRelays: overallRelayStatus([...readRelays], relayHealth),
    backfilling:
      !Result.isSuccess(backfillingResult) || backfillingResult.value,
  };
  const status = deriveNetworkStatus(inputs);
  const latestInputs = React.useRef(inputs);
  React.useEffect(() => {
    latestInputs.current = inputs;
  });

  const [shown, setShown] = React.useState(status);
  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setShown(status),
      status === "synced" ? 0 : UNSETTLED_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  React.useEffect(() => {
    reportAppLog({
      tag: "network.statusChanged",
      summary: `Network status is ${shown}`,
      payload: { status: shown, ...latestInputs.current },
    });
  }, [shown]);

  return shown;
};
