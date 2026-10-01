import { Schema } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import {
  loadRecommendedRelays,
  RecommendedRelayLists,
  saveRecommendedRelays,
  withFetchedRecommendedRelays,
  type RecommendedRelays,
} from "../../utils/recommendedRelays";

const RECOMMENDED_RELAYS_URL = "https://linky.fit/recommended-relays";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Dev and e2e builds point at local services and never fetch the endpoint.
const usesEnvRelays = Boolean(
  import.meta.env.VITE_NOSTR_RELAYS || import.meta.env.VITE_EVOLU_SERVER_URLS,
);

const fetchRecommendedRelays = async (): Promise<RecommendedRelays | null> => {
  try {
    const response = await fetch(RECOMMENDED_RELAYS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const fetched = Schema.decodeUnknownSync(RecommendedRelayLists)(
      await response.json(),
    );
    const next = withFetchedRecommendedRelays(loadRecommendedRelays(), fetched);
    saveRecommendedRelays(next);
    reportAppLog({
      tag: "recommendedRelays.fetched",
      summary: "Fetched the recommended Nostr and Evolu relays",
      payload: next,
    });
    return next;
  } catch (error) {
    reportAppLog({
      tag: "recommendedRelays.fetchFailed",
      summary: "Fetching the recommended relays failed; using the cached list",
      payload: { error },
    });
    return null;
  }
};

/** The cached recommendation, refreshed at launch and once a day. */
export const useRecommendedRelays = (
  networkEnabled: boolean,
): {
  recommendedRelays: RecommendedRelays;
  unretireNostrRelay: (isSameRelay: (url: string) => boolean) => void;
} => {
  const [relays, setRelays] = React.useState(loadRecommendedRelays);

  // A user may add a retired relay back on purpose.
  const unretireNostrRelay = React.useCallback(
    (isSameRelay: (url: string) => boolean) => {
      const current = loadRecommendedRelays();
      if (!current.retiredNostr.some(isSameRelay)) return;
      const next = {
        ...current,
        retiredNostr: current.retiredNostr.filter((url) => !isSameRelay(url)),
      };
      saveRecommendedRelays(next);
      setRelays(next);
    },
    [],
  );

  React.useEffect(() => {
    if (!networkEnabled || usesEnvRelays) return;
    let cancelled = false;
    const refresh = () => {
      void fetchRecommendedRelays().then((next) => {
        if (next === null || cancelled) return;
        // Keep the identity when nothing changed so relay runtimes are not rebuilt.
        setRelays((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      });
    };
    refresh();
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [networkEnabled]);

  return { recommendedRelays: relays, unretireNostrRelay };
};
