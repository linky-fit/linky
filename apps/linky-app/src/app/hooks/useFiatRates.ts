import { useAtomValue, useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import { useDeferredOnlineReady } from "../../hooks/useDeferredOnlineReady";
import {
  FIAT_RATES_CACHE_STORAGE_KEY,
  FIAT_RATES_TTL_MS,
} from "../../utils/constants";
import type { FiatRates } from "../../utils/displayAmounts";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../utils/storage";
import {
  decodeFiatRates,
  isFiatRatesStale,
  fetchFiatRates,
} from "@linky-fit/linkshu";
import { fiatRatesAtom } from "../state/shell/displayPrefs";

const readCachedFiatRates = () =>
  decodeFiatRates(safeLocalStorageGet(FIAT_RATES_CACHE_STORAGE_KEY));

export const useFiatRates = (): FiatRates | null => useAtomValue(fiatRatesAtom);

/** Refreshes the cached fiat rates once they are stale; the app shell runs it once. */
export const useFiatRatesSync = (): void => {
  const canRunNetworkWork = useDeferredOnlineReady();
  const setFiatRates = useAtomSet(fiatRatesAtom);

  React.useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;

    const cached = readCachedFiatRates();
    setFiatRates(cached);

    if (!canRunNetworkWork) {
      return () => {
        cancelled = true;
        activeController?.abort();
      };
    }

    const syncRates = async () => {
      const cached = readCachedFiatRates();
      if (!cancelled) setFiatRates(cached);
      if (!isFiatRatesStale(cached)) return;

      const controller = new AbortController();
      activeController = controller;

      try {
        const next = await fetchFiatRates(controller.signal);
        if (!next || cancelled) return;
        safeLocalStorageSet(FIAT_RATES_CACHE_STORAGE_KEY, JSON.stringify(next));
        setFiatRates(next);
      } catch {
        // ignore rate fetch errors and keep the last cached value
      } finally {
        if (activeController === controller) activeController = null;
      }
    };

    void syncRates();
    const intervalId = setInterval(() => {
      void syncRates();
    }, FIAT_RATES_TTL_MS);

    return () => {
      cancelled = true;
      if (activeController) activeController.abort();
      clearInterval(intervalId);
    };
  }, [canRunNetworkWork, setFiatRates]);
};
