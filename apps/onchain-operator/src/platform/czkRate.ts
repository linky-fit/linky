import {
  decodeFiatRates,
  fetchFiatRates,
  FIAT_RATES_CACHE_STORAGE_KEY,
  isFiatRatesStale,
  type FiatRates,
} from "@linky-fit/linkshu";
import { useEffect, useState } from "react";

const readCached = (): FiatRates | null => {
  try {
    return decodeFiatRates(localStorage.getItem(FIAT_RATES_CACHE_STORAGE_KEY));
  } catch {
    return null;
  }
};

/** CZK per bitcoin from the cached rates, refreshed once they are stale; `null` until known. */
export const useCzkPerBtc = (): number | null => {
  const [rates, setRates] = useState<FiatRates | null>(readCached);
  useEffect(() => {
    if (!isFiatRatesStale(rates)) return;
    const abort = new AbortController();
    fetchFiatRates(abort.signal)
      .then((fresh) => {
        if (fresh === null) return;
        setRates(fresh);
        try {
          localStorage.setItem(
            FIAT_RATES_CACHE_STORAGE_KEY,
            JSON.stringify(fresh),
          );
        } catch {
          // The rate stays for this visit only.
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [rates]);
  return rates?.czkPerBtc ?? null;
};
