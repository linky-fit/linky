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
} from "@linky/linkshu";

const readCachedFiatRates = () =>
  decodeFiatRates(safeLocalStorageGet(FIAT_RATES_CACHE_STORAGE_KEY));
export const useFiatRates = (): FiatRates | null => {
  const canRunNetworkWork = useDeferredOnlineReady();
  const [fiatRates, setFiatRates] = React.useState<FiatRates | null>(() =>
    readCachedFiatRates(),
  );

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
    const intervalId = window.setInterval(() => {
      void syncRates();
    }, FIAT_RATES_TTL_MS);

    return () => {
      cancelled = true;
      if (activeController) activeController.abort();
      window.clearInterval(intervalId);
    };
  }, [canRunNetworkWork]);

  return fiatRates;
};
