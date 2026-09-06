import type { FiatRates } from "@linky/linkshu";
export type { FiatRates } from "@linky/linkshu";
import { formatInteger, normalizeLocale } from "./formatting";

type FiatDisplayCurrency = "czk" | "eur" | "chf" | "usd";

export type DisplayCurrency = "sat" | "btc" | FiatDisplayCurrency | "hidden";

export const DISPLAY_CURRENCIES: ReadonlyArray<DisplayCurrency> = [
  "sat",
  "btc",
  "czk",
  "eur",
  "chf",
  "usd",
  "hidden",
];

export interface DisplayAmountOptions {
  displayCurrency: DisplayCurrency;
  fiatRates: FiatRates | null;
  lang?: string;
}

export interface DisplayAmountParts {
  amountText: string;
  approxPrefix: string;
  unitLabel: string;
}

const SATS_PER_BTC = 100_000_000;

export const isFiatDisplayCurrency = (
  displayCurrency: DisplayCurrency,
): displayCurrency is FiatDisplayCurrency =>
  displayCurrency === "czk" ||
  displayCurrency === "eur" ||
  displayCurrency === "chf" ||
  displayCurrency === "usd";

const getRateForCurrency = (
  displayCurrency: FiatDisplayCurrency,
  fiatRates: FiatRates,
): number => {
  switch (displayCurrency) {
    case "czk":
      return fiatRates.czkPerBtc;
    case "eur":
      return fiatRates.eurPerBtc;
    case "chf":
      return fiatRates.chfPerBtc;
    case "usd":
      return fiatRates.usdPerBtc;
  }
};

const fiatFormatters = new Map<string, Intl.NumberFormat>();

const isDisplayCurrency = (value: unknown): value is DisplayCurrency =>
  DISPLAY_CURRENCIES.some((currency) => currency === value);

export const parseDisplayCurrency = (
  value: string | null | undefined,
): DisplayCurrency | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "sat") return "sat";
  if (normalized === "btc" || normalized === "b") return "btc";
  if (normalized === "czk") return "czk";
  if (normalized === "eur") return "eur";
  if (normalized === "chf") return "chf";
  if (normalized === "usd") return "usd";
  if (normalized === "hidden" || normalized === "masked") return "hidden";
  return null;
};

export const normalizeAllowedDisplayCurrencies = (
  values: readonly string[] | null | undefined,
  fallbackCurrency: DisplayCurrency,
): DisplayCurrency[] => {
  const normalized: DisplayCurrency[] = [];

  for (const candidate of values ?? []) {
    if (!isDisplayCurrency(candidate)) continue;
    if (normalized.includes(candidate)) continue;
    normalized.push(candidate);
  }

  if (normalized.length > 0) return normalized;
  return [fallbackCurrency];
};

export const getNextDisplayCurrency = (
  currentCurrency: DisplayCurrency,
  allowedCurrencies: readonly DisplayCurrency[],
): DisplayCurrency => {
  const normalizedAllowed = normalizeAllowedDisplayCurrencies(
    allowedCurrencies,
    currentCurrency,
  );

  if (normalizedAllowed.length <= 1)
    return normalizedAllowed[0] ?? currentCurrency;

  const currentOrderIndex = DISPLAY_CURRENCIES.indexOf(currentCurrency);
  const orderedAllowed = DISPLAY_CURRENCIES.filter((currency) =>
    normalizedAllowed.includes(currency),
  );

  if (orderedAllowed.length <= 1) return orderedAllowed[0] ?? currentCurrency;

  for (let offset = 1; offset <= DISPLAY_CURRENCIES.length; offset += 1) {
    const nextIndex = (currentOrderIndex + offset) % DISPLAY_CURRENCIES.length;
    const nextCurrency = DISPLAY_CURRENCIES[nextIndex];
    if (nextCurrency && orderedAllowed.includes(nextCurrency)) {
      return nextCurrency;
    }
  }

  return orderedAllowed[0] ?? currentCurrency;
};

export const getDisplayUnitLabel = (
  displayCurrency: DisplayCurrency,
  lang?: string,
): string => {
  switch (displayCurrency) {
    case "btc":
      return "₿";
    case "czk":
      return normalizeLocale(lang).startsWith("cs") ? "Kč" : "CZK";
    case "eur":
      return "EUR";
    case "chf":
      return "CHF";
    case "usd":
      return "USD";
    case "hidden":
      return "*****";
    case "sat":
      return "sat";
  }
};

const getFiatFormatter = (
  locale: string,
  currency: FiatDisplayCurrency,
): Intl.NumberFormat => {
  const cacheKey = `${locale}:${currency}`;
  const existing = fiatFormatters.get(cacheKey);
  if (existing) return existing;

  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
  fiatFormatters.set(cacheKey, formatter);
  return formatter;
};

const normalizeAmountSat = (amountSat: number): number => {
  if (!Number.isFinite(amountSat)) return 0;
  return Math.max(0, Math.trunc(amountSat));
};

const getFiatValue = (
  amountSat: number,
  displayCurrency: FiatDisplayCurrency,
  fiatRates: FiatRates,
): number => {
  const btcAmount = amountSat / SATS_PER_BTC;
  const rate = getRateForCurrency(displayCurrency, fiatRates);
  return btcAmount * rate;
};

const parsePositiveInteger = (value: string): number => {
  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) return 0;
  const parsed = Number.parseInt(digitsOnly, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const parsePositiveDisplayNumber = (value: string): number => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return 0;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const getDisplayAmountInputValue = (
  amountSat: number,
  options: DisplayAmountOptions,
): string => {
  const normalizedAmount = normalizeAmountSat(amountSat);
  if (normalizedAmount <= 0) return "";

  if (isFiatDisplayCurrency(options.displayCurrency) && options.fiatRates) {
    return String(
      Math.max(
        0,
        Math.round(
          getFiatValue(
            normalizedAmount,
            options.displayCurrency,
            options.fiatRates,
          ),
        ),
      ),
    );
  }

  return String(normalizedAmount);
};

const toAmountSatFromDisplayInput = (
  displayValue: string,
  options: DisplayAmountOptions,
): number => {
  const parsedDisplayValue = parsePositiveDisplayNumber(displayValue);
  if (parsedDisplayValue <= 0) return 0;

  if (isFiatDisplayCurrency(options.displayCurrency) && options.fiatRates) {
    const rate = getRateForCurrency(options.displayCurrency, options.fiatRates);
    const amountSat = Math.round((parsedDisplayValue / rate) * SATS_PER_BTC);
    return Number.isFinite(amountSat) && amountSat > 0 ? amountSat : 0;
  }

  return parsedDisplayValue;
};

interface AmountInputKeyResult {
  amountSat: string;
  displayValue: string;
}

export const applyAmountInputKeyWithDraft = (
  currentAmount: string,
  currentDisplayValue: string | null,
  key: string,
  options: DisplayAmountOptions,
  allowDecimals: boolean,
): AmountInputKeyResult => {
  const currentAmountSat = parsePositiveInteger(currentAmount);
  const displayValue =
    currentDisplayValue ??
    getDisplayAmountInputValue(currentAmountSat, options);

  let nextDisplayValue = displayValue;
  if (key === "C") {
    nextDisplayValue = "";
  } else if (key === "⌫") {
    nextDisplayValue = displayValue.slice(0, -1);
  } else if (key === "." || key === ",") {
    if (allowDecimals && !displayValue.includes(".")) {
      nextDisplayValue = `${displayValue || "0"}.`;
    }
  } else if (/^\d$/.test(key)) {
    const candidate = (displayValue + key).replace(/^0+(\d)/, "$1");
    if (!allowDecimals || /^\d*(?:\.\d{0,2})?$/.test(candidate)) {
      nextDisplayValue = candidate;
    }
  }

  const nextAmountSat = toAmountSatFromDisplayInput(nextDisplayValue, options);
  return {
    amountSat: nextAmountSat > 0 ? String(nextAmountSat) : "",
    displayValue: nextDisplayValue,
  };
};

export const applyAmountInputKey = (
  currentAmount: string,
  key: string,
  options: DisplayAmountOptions,
): string => {
  const currentAmountSat = parsePositiveInteger(currentAmount);
  const currentDisplayValue = getDisplayAmountInputValue(
    currentAmountSat,
    options,
  );

  return applyAmountInputKeyWithDraft(
    currentAmount,
    currentDisplayValue,
    key,
    options,
    false,
  ).amountSat;
};

export const formatDisplayAmountParts = (
  amountSat: number,
  options: DisplayAmountOptions,
): DisplayAmountParts => {
  const normalizedAmount = normalizeAmountSat(amountSat);
  const locale = normalizeLocale(options.lang);

  if (options.displayCurrency === "hidden") {
    return {
      amountText: "*****",
      approxPrefix: "",
      unitLabel: "",
    };
  }

  if (options.displayCurrency === "btc") {
    return {
      amountText: formatInteger(normalizedAmount, options.lang),
      approxPrefix: "",
      unitLabel: getDisplayUnitLabel("btc", options.lang),
    };
  }

  if (isFiatDisplayCurrency(options.displayCurrency) && options.fiatRates) {
    const currency = options.displayCurrency;
    return {
      amountText: getFiatFormatter(locale, currency).format(
        getFiatValue(normalizedAmount, currency, options.fiatRates),
      ),
      approxPrefix: normalizedAmount > 0 ? "~" : "",
      unitLabel: getDisplayUnitLabel(currency, options.lang),
    };
  }

  return {
    amountText: formatInteger(normalizedAmount, options.lang),
    approxPrefix: "",
    unitLabel: getDisplayUnitLabel("sat", options.lang),
  };
};

export const formatDisplayAmountText = (
  amountSat: number,
  options: DisplayAmountOptions,
): string => {
  const parts = formatDisplayAmountParts(amountSat, options);
  return [`${parts.approxPrefix}${parts.amountText}`, parts.unitLabel.trim()]
    .filter(Boolean)
    .join(" ");
};
