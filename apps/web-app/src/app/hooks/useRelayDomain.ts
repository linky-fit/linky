import {
  identityFromNsec,
  RelayListEntry,
  RelayListsDraft,
} from "@linky-fit/linkstr";
import {
  fetchOwnRelayListsAtom,
  publishRelayListsAtom,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import {
  isRecommendedNostrRelay,
  isRelayUrl,
  loadCachedRelayLists,
  relayIdentity,
  saveCachedRelayLists,
  withRecommendedNostrRelays,
} from "../../utils/nostrRelays";
import { useRecommendedRelays } from "./useRecommendedRelays";
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
  isRecommendedRelay: (url: string) => boolean;
  newRelayUrl: string;
  pendingRelayDeleteUrl: string | null;
  relayUrls: string[];
  requestDeleteSelectedRelay: () => void;
  saveNewRelay: () => void;
  selectedRelayUrl: string | null;
  setNewRelayUrl: React.Dispatch<React.SetStateAction<string>>;
}

function haveSameRelayUrls(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightIds = new Set(right.filter(isRelayUrl).map(relayIdentity));
  const leftIds = new Set(left.filter(isRelayUrl).map(relayIdentity));
  return (
    leftIds.size === rightIds.size &&
    [...leftIds].every((id) => rightIds.has(id))
  );
}

const loadCachedRelayUrls = (pubkey: string | null): string[] => [
  ...((pubkey === null ? null : loadCachedRelayLists(pubkey))?.relayUrls ?? []),
];

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

  const { recommendedRelays, unretireNostrRelay } =
    useRecommendedRelays(networkEnabled);

  // Keeps the array identity while the relays stay the same, because a new
  // array rebuilds the Nostr runtime and replays the inbox.
  const [relayUrls, setRelayUrls] = React.useState<string[]>(() =>
    withRecommendedNostrRelays(
      loadCachedRelayUrls(cachePubkey),
      recommendedRelays,
    ),
  );
  const updateRelayUrls = React.useCallback(
    (urls: readonly string[]) => {
      const next = withRecommendedNostrRelays(urls, recommendedRelays);
      setRelayUrls((current) =>
        haveSameRelayUrls(current, next) ? current : next,
      );
    },
    [recommendedRelays],
  );

  React.useEffect(() => {
    updateRelayUrls(loadCachedRelayUrls(cachePubkey));
  }, [cachePubkey, updateRelayUrls]);

  const isRecommendedRelay = React.useCallback(
    (url: string) => isRecommendedNostrRelay(url, recommendedRelays),
    [recommendedRelays],
  );

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
      return exit.value;
    },
    [currentNsec, publishRelayLists],
  );

  const fetchOwnRelayLists = useAtomSet(fetchOwnRelayListsAtom, {
    mode: "promiseExit",
  });

  const relayProfileSyncForNpubRef = React.useRef<string | null>(null);
  const [syncAttempt, retrySync] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!networkEnabled) return;
    if (!currentNpub || !currentNsec) return;

    const relaySyncKey = relayProfileSyncKey(currentNpub, relayUrls);
    if (relayProfileSyncForNpubRef.current === relaySyncKey) return;

    let cancelled = false;
    let publishing = false;
    let retryTimeout: number | undefined;

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
        const publishedUrls =
          relayListUrls.length > 0 ? relayListUrls : inboxRelayUrls;

        if (cancelled) return;

        const cached =
          cachePubkey === null ? null : loadCachedRelayLists(cachePubkey);
        // A relay can serve lists older than the ones this device last saved.
        const source =
          publishedUrls.length === 0 ||
          (cached !== null && newestUpdatedAt(lists) < newestUpdatedAt(cached))
            ? (cached?.relayUrls ?? [])
            : publishedUrls;
        const urls = withRecommendedNostrRelays(source, recommendedRelays);

        if (
          haveSameRelayUrls(relayListUrls, urls) &&
          haveSameRelayUrls(inboxRelayUrls, urls)
        ) {
          if (cachePubkey !== null) {
            saveCachedRelayLists(cachePubkey, {
              relayUrls: urls,
              relaysUpdatedAt: lists.relaysUpdatedAt,
              dmRelaysUpdatedAt: lists.dmRelaysUpdatedAt,
            });
          }
        } else {
          publishing = true;
          // Publish before changing state: changing relays rebuilds the runtime
          // and interrupts any in-flight publish on the previous runtime.
          const receipt = await publishNostrRelayLists(urls);
          if (cancelled) return;
          if (cachePubkey !== null) {
            saveCachedRelayLists(cachePubkey, {
              relayUrls: urls,
              relaysUpdatedAt: receipt.relayList.sentAt,
              dmRelaysUpdatedAt: receipt.dmRelayList.sentAt,
            });
          }
          reportAppLog({
            tag: "relayList.reconciled",
            summary:
              "Published the Nostr relay lists with the recommended relays",
            links: {
              wrap: [receipt.relayList.eventId, receipt.dmRelayList.eventId],
            },
            payload: { relayUrls: urls, previousRelayUrls: publishedUrls },
          });
        }

        // Record before updateRelayUrls: the state change re-runs this effect,
        // and the recorded key makes that follow-up run a no-op.
        relayProfileSyncForNpubRef.current = relayProfileSyncKey(
          currentNpub,
          urls,
        );
        updateRelayUrls(urls);
      } catch (e) {
        if (cancelled) return;
        relayProfileSyncForNpubRef.current = null;
        if (publishing) {
          retryTimeout = window.setTimeout(retrySync, 30_000);
        }
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
      window.clearTimeout(retryTimeout);
    };
  }, [
    cachePubkey,
    currentNpub,
    currentNsec,
    fetchOwnRelayLists,
    networkEnabled,
    publishNostrRelayLists,
    recommendedRelays,
    relayUrls,
    syncAttempt,
    updateRelayUrls,
  ]);

  const saveNewRelay = React.useCallback(() => {
    const url = newRelayUrl.trim();
    if (!url) {
      setStatus(`${t("errorPrefix")}: ${t("fillAtLeastOne")}`);
      return;
    }

    if (!isRelayUrl(url)) {
      setStatus(`${t("errorPrefix")}: ${t("invalidRelayUrl")}`);
      return;
    }

    const already = relayUrls.some(
      (u) => relayIdentity(u) === relayIdentity(url),
    );
    if (already) {
      navigateTo({ route: "relays" });
      return;
    }

    const nextUrls = [...relayUrls, url];
    unretireNostrRelay(
      (retired) => relayIdentity(retired) === relayIdentity(url),
    );
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
    navigateTo({ route: "relays" });
  }, [
    currentNpub,
    newRelayUrl,
    persistLocalRelayUrls,
    publishNostrRelayLists,
    relayUrls,
    setStatus,
    t,
    unretireNostrRelay,
  ]);

  const requestDeleteSelectedRelay = React.useCallback(() => {
    if (route.kind !== "nostrRelay") return;
    if (!selectedRelayUrl) return;
    if (isRecommendedRelay(selectedRelayUrl)) return;
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
      navigateTo({ route: "relays" });
      return;
    }

    setPendingRelayDeleteUrl(selectedRelayUrl);
    setStatus(t("deleteArmedHint"));
  }, [
    currentNpub,
    isRecommendedRelay,
    pendingRelayDeleteUrl,
    persistLocalRelayUrls,
    publishNostrRelayLists,
    relayUrls,
    route.kind,
    selectedRelayUrl,
    setStatus,
    t,
  ]);

  const canSaveNewRelay = isRelayUrl(newRelayUrl.trim());

  return {
    canSaveNewRelay,
    isRecommendedRelay,
    newRelayUrl,
    pendingRelayDeleteUrl,
    relayUrls,
    requestDeleteSelectedRelay,
    saveNewRelay,
    selectedRelayUrl,
    setNewRelayUrl,
  };
};
