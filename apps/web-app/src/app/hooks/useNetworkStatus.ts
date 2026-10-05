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
import {
  countConnectedRelays,
  overallRelayStatus,
  useRelayHealth,
} from "./useRelayHealth";
import type { RelayDotState } from "./useRelayHealth";

export type NetworkStatus = "offline" | "syncing" | "synced";

export type EvoluPhase =
  | "unconfigured"
  | "unreachable"
  | "connecting"
  | "syncing"
  | "synced";

export type NostrPhase =
  | "unconfigured"
  | "unreachable"
  | "connecting"
  | "scanning"
  | "synced";

interface Side<P> {
  phase: P;
  connected: number;
  total: number;
}

export interface NetworkReport {
  status: NetworkStatus;
  online: boolean;
  evolu: Side<EvoluPhase>;
  nostr: Side<NostrPhase>;
}

/** Leaving "synced" waits this long, so a short sync round or reconnect does not flash the tab. */
const UNSETTLED_AFTER_MS = 1_000;

const isOpen = (status: EvoluRelayStatus | undefined) =>
  status === "syncing" || status === "synced";

export const evoluPhase = (
  relays: ReadonlyArray<EvoluRelayStatus | undefined>,
  hydrated: boolean,
): EvoluPhase => {
  if (relays.length === 0) return "unconfigured";
  if (relays.some(isOpen))
    return hydrated && !relays.includes("syncing") ? "synced" : "syncing";
  return relays.some(
    (status) => status === undefined || status === "connecting",
  )
    ? "connecting"
    : "unreachable";
};

export const nostrPhase = (
  relayCount: number,
  relays: RelayDotState,
  backfilling: boolean,
): NostrPhase => {
  if (relayCount === 0) return "unconfigured";
  if (relays === "disconnected") return "unreachable";
  if (relays === "checking") return "connecting";
  return backfilling ? "scanning" : "synced";
};

/** Offline when the browser is or either side reaches no relay, syncing while either still connects or delivers stored data. */
export const networkStatusOf = (
  online: boolean,
  evolu: EvoluPhase,
  nostr: NostrPhase,
): NetworkStatus => {
  const phases: ReadonlyArray<EvoluPhase | NostrPhase> = [evolu, nostr];
  if (
    !online ||
    phases.some((phase) => phase === "unconfigured" || phase === "unreachable")
  )
    return "offline";
  return phases.every((phase) => phase === "synced") ? "synced" : "syncing";
};

/** Whether the device reaches its Evolu and Nostr relays and has received what they hold, and what each side is doing. */
export const useNetworkStatus = (): NetworkReport => {
  const online = useOnline();
  const evoluStatuses = useEvoluRelayStatuses();
  const hydrated = useAccountHydrated();
  const readRelays = useAtomValue(linkstrConfigAtom)?.readRelays ?? [];
  const relayHealth = useRelayHealth();
  const backfillingResult = useAtomValue(inboxBackfillingAtom);
  const backfilling =
    !Result.isSuccess(backfillingResult) || backfillingResult.value;

  const evoluRelays = EVOLU_SERVER_URLS.map((url) => evoluStatuses[url]);
  const evolu: Side<EvoluPhase> = {
    phase: evoluPhase(evoluRelays, hydrated),
    connected: evoluRelays.filter(isOpen).length,
    total: evoluRelays.length,
  };
  const nostrUrls = [...readRelays];
  const nostr: Side<NostrPhase> = {
    phase: nostrPhase(
      nostrUrls.length,
      overallRelayStatus(nostrUrls, relayHealth),
      backfilling,
    ),
    connected: countConnectedRelays(nostrUrls, relayHealth),
    total: nostrUrls.length,
  };
  const status = networkStatusOf(online, evolu.phase, nostr.phase);

  const [shown, setShown] = React.useState(status);
  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setShown(status),
      status === "synced" ? 0 : UNSETTLED_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  const report: NetworkReport = { status: shown, online, evolu, nostr };
  const latestContext = React.useRef({ report, hydrated, backfilling });
  React.useEffect(() => {
    latestContext.current = { report, hydrated, backfilling };
  });
  React.useEffect(() => {
    const { report, hydrated, backfilling } = latestContext.current;
    reportAppLog({
      tag: "network.statusChanged",
      summary: `Network status is ${shown}`,
      payload: { ...report, hydrated, backfilling },
    });
  }, [shown]);

  return report;
};
