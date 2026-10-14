import { fetchFiatRates, isFiatRatesStale } from "@linky-fit/linkshu";
import type { FiatRates } from "@linky-fit/linkshu";

const FETCH_TIMEOUT_MS = 8_000;

/** The CZK price of bitcoin. In memory only: a rate is not worth syncing. */
export interface Rates {
  /** CZK per BTC, at most 10 minutes old; `null` while the rate service cannot be reached. */
  readonly czkPerBtc: () => Promise<number | null>;
}

export const createRates = (
  fetchRates: (
    signal: AbortSignal,
  ) => Promise<FiatRates | null> = fetchFiatRates,
): Rates => {
  let latest: FiatRates | null = null;
  let inflight: Promise<number | null> | null = null;

  const fetchCzkPerBtc = async (): Promise<number | null> => {
    try {
      const rates = await fetchRates(AbortSignal.timeout(FETCH_TIMEOUT_MS));
      if (rates !== null) latest = rates;
    } catch (error) {
      console.warn("[fazole] fiat rates unavailable", error);
    }
    return isFiatRatesStale(latest) ? null : (latest?.czkPerBtc ?? null);
  };

  return {
    czkPerBtc: () => {
      if (latest !== null && !isFiatRatesStale(latest)) {
        return Promise.resolve(latest.czkPerBtc);
      }
      inflight ??= fetchCzkPerBtc().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
};
