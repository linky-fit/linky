import { Schema } from "effect";
const PositiveNumber = Schema.Number.pipe(Schema.finite(), Schema.positive());
export const FiatRates = Schema.Struct({
  brlPerBtc: PositiveNumber,
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
const YadioRates = Schema.Struct({
  BTC: Schema.Struct({
    BRL: Schema.Number,
    CHF: Schema.Number,
    CZK: Schema.Number,
    EUR: Schema.Number,
    USD: Schema.Number,
  }),
});
export const fetchFiatRates = async (
  signal: AbortSignal,
): Promise<FiatRates | null> => {
  const response = await fetch("https://api.yadio.io/exrates/BTC", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownOption(YadioRates)(payload);
  if (parsed._tag === "None") return null;
  const rates = parsed.value.BTC;
  const result = {
    brlPerBtc: rates.BRL,
    chfPerBtc: rates.CHF,
    czkPerBtc: rates.CZK,
    eurPerBtc: rates.EUR,
    usdPerBtc: rates.USD,
    fetchedAtMs: Date.now(),
  };
  return Schema.is(FiatRates)(result) ? result : null;
};
