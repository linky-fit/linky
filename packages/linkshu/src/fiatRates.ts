import { Schema } from "effect";
const PositiveNumber = Schema.Number.pipe(Schema.finite(), Schema.positive());
export const FiatRates = Schema.Struct({
  chfPerBtc: PositiveNumber,
  czkPerBtc: PositiveNumber,
  eurPerBtc: PositiveNumber,
  fetchedAtMs: PositiveNumber,
  usdPerBtc: PositiveNumber,
});
export type FiatRates = typeof FiatRates.Type;
export const FIAT_RATES_CACHE_STORAGE_KEY = "linky.fiat_rates.v1";
export const FIAT_RATES_TTL_MS = 10 * 60 * 1000;
export const decodeFiatRates = (raw: string | null): FiatRates | null => {
  const decoded = Schema.decodeUnknownOption(Schema.parseJson(FiatRates))(raw);
  return decoded._tag === "Some" ? decoded.value : null;
};
export const isFiatRatesStale = (rates: FiatRates | null): boolean =>
  !rates || Date.now() - rates.fetchedAtMs >= FIAT_RATES_TTL_MS;
const CoinbaseRates = Schema.Struct({
  data: Schema.Struct({
    rates: Schema.Struct({
      CHF: Schema.NumberFromString,
      CZK: Schema.NumberFromString,
      EUR: Schema.NumberFromString,
      USD: Schema.NumberFromString,
    }),
  }),
});
export const fetchFiatRates = async (
  signal: AbortSignal,
): Promise<FiatRates | null> => {
  const response = await fetch(
    "https://api.coinbase.com/v2/exchange-rates?currency=BTC",
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownOption(CoinbaseRates)(payload);
  if (parsed._tag === "None") return null;
  const rates = parsed.value.data.rates;
  const result = {
    chfPerBtc: rates.CHF,
    czkPerBtc: rates.CZK,
    eurPerBtc: rates.EUR,
    usdPerBtc: rates.USD,
    fetchedAtMs: Date.now(),
  };
  return Schema.is(FiatRates)(result) ? result : null;
};
