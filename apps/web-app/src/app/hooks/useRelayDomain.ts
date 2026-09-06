import {
  identityFromNsec,
  RelayListEntry,
  RelayListsDraft,
  RelayUrl,
} from "@linky/linkstr";
import {
  fetchOwnRelayListsAtom,
  publishRelayListsAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit, Schema } from "effect";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import {
  loadCachedRelayLists,
  NOSTR_RELAYS,
  saveCachedRelayLists,
} from "../../utils/nostrRelays";
import { nowSeconds } from "../../utils/time";
import type { Translate } from "../../i18n";

import { reportAppLog } from "../../devtools/inspector/appLog";
interface UseRelayDomainParams {
  currentNpub: string | null;
  currentNsec: string | null;
  networkEnabled: boolean;
  route: Route;
  setStatus: (value: string | null) => void;
  t: Translate;
}

interface UseRelayDomainResult {
  canSaveNewRelay: boolean;
  newRelayUrl: string;
  nostrFetchRelays: string[];
  pendingRelayDeleteUrl: string | null;
  relayUrls: string[];
  requestDeleteSelectedRelay: () => void;
  saveNewRelay: () => void;
  selectedRelayUrl: string | null;
  setNewRelayUrl: React.Dispatch<React.SetStateAction<string>>;
}

const isRelayUrl = Schema.is(RelayUrl);

function haveSameRelayUrls(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((url, index) => url === sortedRight[index]);
}

function newestUpdatedAt(lists: {
  relaysUpdatedAt: number | null;
  dmRelaysUpdatedAt: number | null;
}): number {
  return Math.max(lists.relaysUpdatedAt ?? 0, lists.dmRelaysUpdatedAt ?? 0);
}

function relayProfileSyncKey(npub: string, urls: readonly string[]): string {
  return `${npub}|${Array.from(
    new Set(urls.map((relay) => relay.trim()).filter(Boolean)),
  )
    .sort()
    .join(",")}`;
}

export const useRelayDomain = ({
  currentNpub,
  currentNsec,
  networkEnabled,
  route,
  setStatus,
  t,
}: UseRelayDomainParams): UseRelayDomainResult => {
  const [newRelayUrl, setNewRelayUrl] = React.useState<string>("");

  // Hex pubkey derived synchronously from the nsec (currentNpub arrives a
  // render later), so the cache below is usable from the very first render.
  const cachePubkey = React.useMemo(() => {
    const nsec = (currentNsec ?? "").trim();
    if (!nsec) return null;
    return identityFromNsec(nsec)?.pubkey ?? null;
  }, [currentNsec]);

  const [relayUrls, setRelayUrls] = React.useState<string[]>(() => {
    const cached =
      cachePubkey === null ? null : loadCachedRelayLists(cachePubkey);
    return cached === null ? [...NOSTR_RELAYS] : [...cached.relayUrls];
  });

  React.useEffect(() => {
    const cached =
      cachePubkey === null ? null : loadCachedRelayLists(cachePubkey);
    const next = cached === null ? NOSTR_RELAYS : cached.relayUrls;
    setRelayUrls((current) =>
      haveSameRelayUrls(current, next) ? current : [...next],
    );
  }, [cachePubkey]);

  const persistLocalRelayUrls = React.useCallback(
    (urls: readonly string[]) => {
      if (cachePubkey === null) return;
      const nowSec = nowSeconds();
      saveCachedRelayLists(cachePubkey, {
        relayUrls: urls,
        relaysUpdatedAt: nowSec,
        dmRelaysUpdatedAt: nowSec,
      });
    },
    [cachePubkey],
  );
  const [pendingRelayDeleteUrl, setPendingRelayDeleteUrl] = React.useState<
    string | null
  >(null);
  React.useEffect(() => {
    if (!pendingRelayDeleteUrl) return;
    const timeoutId = window.setTimeout(() => {
      setPendingRelayDeleteUrl(null);
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [pendingRelayDeleteUrl]);

  const nostrFetchRelays = React.useMemo(() => {
    const merged = [...relayUrls, ...NOSTR_RELAYS];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of merged) {
      const url = raw.trim();
      if (!isRelayUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }, [relayUrls]);

  const selectedRelayUrl = React.useMemo(() => {
    if (route.kind !== "nostrRelay") return null;
    const url = route.id.trim();
    return url || null;
  }, [route]);

  const publishRelayLists = useAtomSet(publishRelayListsAtom, {
    mode: "promiseExit",
  });

  const publishNostrRelayLists = React.useCallback(
    async (urls: string[]) => {
      if (!currentNsec) throw new Error("Missing nsec");

      const unique = Array.from(new Set(urls.map((url) => url.trim()))).filter(
        isRelayUrl,
      );

      const exit = await publishRelayLists(
        new RelayListsDraft({
          relays: unique.map(
            (relay) => new RelayListEntry({ relay, marker: null }),
          ),
          dmRelays: unique,
        }),
      );
      if (Exit.isFailure(exit)) {
        throw new Error("relay list publish failed");
      }
    },
    [currentNsec, publishRelayLists],
  );

  const fetchOwnRelayLists = useAtomSet(fetchOwnRelayListsAtom, {
    mode: "promiseExit",
  });

  const relayProfileSyncForNpubRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!networkEnabled) return;
    if (!currentNpub || !currentNsec) return;

    const relaySyncKey = relayProfileSyncKey(currentNpub, relayUrls);
    if (relayProfileSyncForNpubRef.current === relaySyncKey) return;

    let cancelled = false;

    const run = async () => {
      try {
        const exit = await fetchOwnRelayLists();
        if (Exit.isFailure(exit)) {
          throw new Error("relay list fetch failed");
        }
        const lists = exit.value;

        const relayListUrls = Array.from(
          new Set((lists.relays ?? []).map((entry) => entry.relay)),
        );
        const inboxRelayUrls = Array.from(new Set(lists.dmRelays ?? []));
        const urls = relayListUrls.length > 0 ? relayListUrls : inboxRelayUrls;

        if (cancelled) return;

        const cached =
          cachePubkey === null ? null : loadCachedRelayLists(cachePubkey);

        if (urls.length > 0) {
          if (
            cached !== null &&
            newestUpdatedAt(lists) < newestUpdatedAt(cached)
          ) {
            // A relay served events older than what we already synced; keep
            // the newer cached list and mark this state as synced.
            relayProfileSyncForNpubRef.current = relaySyncKey;
            return;
          }

          // Record before setRelayUrls: the state change re-runs this effect,
          // and the recorded key makes that follow-up run a no-op.
          relayProfileSyncForNpubRef.current = relayProfileSyncKey(
            currentNpub,
            urls,
          );
          setRelayUrls((current) =>
            haveSameRelayUrls(current, urls) ? current : urls,
          );
          if (cachePubkey !== null) {
            saveCachedRelayLists(cachePubkey, {
              relayUrls: urls,
              relaysUpdatedAt: lists.relaysUpdatedAt,
              dmRelaysUpdatedAt: lists.dmRelaysUpdatedAt,
            });
          }

          if (
            currentNsec &&
            !haveSameRelayUrls(relayListUrls, inboxRelayUrls)
          ) {
            await publishNostrRelayLists(urls);
          }
          return;
        }

        // No published list found: republish the last known list so relays
        // regain it, falling back to the defaults for a fresh identity.
        const fallback = cached === null ? NOSTR_RELAYS : cached.relayUrls;
        relayProfileSyncForNpubRef.current = relayProfileSyncKey(
          currentNpub,
          fallback,
        );
        setRelayUrls((current) =>
          haveSameRelayUrls(current, fallback) ? current : [...fallback],
        );
        if (currentNsec) {
          await publishNostrRelayLists([...fallback]);
        }
      } catch (e) {
        relayProfileSyncForNpubRef.current = null;
        reportAppLog({
          tag: "relayList.syncFailed",
          summary: "Relay list sync from relays failed",
          payload: { error: e },
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    cachePubkey,
    currentNpub,
    currentNsec,
    fetchOwnRelayLists,
    networkEnabled,
    publishNostrRelayLists,
    relayUrls,
  ]);

  const saveNewRelay = React.useCallback(() => {
    const url = newRelayUrl.trim();
    if (!url) {
      setStatus(`${t("errorPrefix")}: ${t("fillAtLeastOne")}`);
      return;
    }

    const already = relayUrls.some((u) => u === url);
    if (already) {
      navigateTo({ route: "nostrRelays" });
      return;
    }

    const nextUrls = [...relayUrls, url];
    if (currentNpub) {
      relayProfileSyncForNpubRef.current = relayProfileSyncKey(
        currentNpub,
        nextUrls,
      );
    }
    setRelayUrls(nextUrls);
    persistLocalRelayUrls(nextUrls);
    void publishNostrRelayLists(nextUrls).catch((e) => {
      reportAppLog({
        tag: "relayList.publishFailed",
        summary: "Publishing the relay list failed",
        payload: { error: e, relayCount: nextUrls.length },
      });
    });

    setNewRelayUrl("");
    navigateTo({ route: "nostrRelays" });
  }, [
    currentNpub,
    newRelayUrl,
    persistLocalRelayUrls,
    publishNostrRelayLists,
    relayUrls,
    setStatus,
    t,
  ]);

  const requestDeleteSelectedRelay = React.useCallback(() => {
    if (route.kind !== "nostrRelay") return;
    if (!selectedRelayUrl) return;
    if (relayUrls.length <= 1) {
      setStatus(`${t("errorPrefix")}: ${t("fillAtLeastOne")}`);
      return;
    }

    if (pendingRelayDeleteUrl === selectedRelayUrl) {
      const nextUrls = relayUrls.filter((u) => u !== selectedRelayUrl);
      if (currentNpub) {
        relayProfileSyncForNpubRef.current = relayProfileSyncKey(
          currentNpub,
          nextUrls,
        );
      }
      setRelayUrls(nextUrls);
      persistLocalRelayUrls(nextUrls);
      setPendingRelayDeleteUrl(null);
      void publishNostrRelayLists(nextUrls).catch((e) => {
        reportAppLog({
          tag: "relayList.publishFailed",
          summary: "Publishing the relay list failed",
          payload: { error: e, relayCount: nextUrls.length },
        });
      });
      navigateTo({ route: "nostrRelays" });
      return;
    }

    setPendingRelayDeleteUrl(selectedRelayUrl);
    setStatus(t("deleteArmedHint"));
  }, [
    currentNpub,
    pendingRelayDeleteUrl,
    persistLocalRelayUrls,
    publishNostrRelayLists,
    relayUrls,
    route.kind,
    selectedRelayUrl,
    setStatus,
    t,
  ]);

  const canSaveNewRelay = Boolean(newRelayUrl.trim());

  return {
    canSaveNewRelay,
    newRelayUrl,
    nostrFetchRelays,
    pendingRelayDeleteUrl,
    relayUrls,
    requestDeleteSelectedRelay,
    saveNewRelay,
    selectedRelayUrl,
    setNewRelayUrl,
  };
};
