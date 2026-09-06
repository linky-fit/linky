import { asNonEmptyString } from "./utils/validation";
/**
 * Linky's kind-30315 status conventions: the last status line may carry a
 * comma-separated exchange-currency list; everything transport-level lives in
 * `@linky/linkstr`.
 */

export const PROFILE_STATUS_CURRENCIES = ["BTC", "CZK", "EUR"] as const;
const LEGACY_PROFILE_STATUS_CURRENCIES = ["USD"] as const;
const STATUS_FILTER_PREFIX = "status:";

export type ProfileStatusCurrency = (typeof PROFILE_STATUS_CURRENCIES)[number];

interface ParsedProfileGeneralStatus {
  currencies: ProfileStatusCurrency[];
  text: string | null;
}

const CURRENCY_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

const parseCurrencyStatusCodes = (
  status: string | null | undefined,
): string[] | null => {
  const normalizedStatus = asNonEmptyString(status);
  if (!normalizedStatus) return null;

  const parts = normalizedStatus
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const uniqueParts = [...new Set(parts)];
  if (uniqueParts.length !== parts.length) return null;
  if (!uniqueParts.every((part) => CURRENCY_CODE_PATTERN.test(part))) {
    return null;
  }

  return uniqueParts;
};

const parseLinkyProfileExchangeStatus = (
  status: string | null | undefined,
): ProfileStatusCurrency[] | null => {
  const parts = parseCurrencyStatusCodes(status);
  if (!parts) return null;
  if (parts.length === 0) return null;

  const validCurrencies = new Set<string>([
    ...PROFILE_STATUS_CURRENCIES,
    ...LEGACY_PROFILE_STATUS_CURRENCIES,
  ]);
  if (!parts.every((part) => validCurrencies.has(part))) return null;

  const supportedCurrencies = new Set<string>(PROFILE_STATUS_CURRENCIES);
  return parts.filter((part): part is ProfileStatusCurrency =>
    supportedCurrencies.has(part),
  );
};

export const parseProfileGeneralStatus = (
  status: string | null | undefined,
): ParsedProfileGeneralStatus => {
  const normalizedStatus = asNonEmptyString(status);
  if (!normalizedStatus) {
    return {
      currencies: [],
      text: null,
    };
  }

  const lines = normalizedStatus.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const maybeCurrencies = parseLinkyProfileExchangeStatus(lines[index]);
    if (!maybeCurrencies) continue;

    const text = asNonEmptyString(lines.slice(0, index).join("\n"));
    return {
      currencies: maybeCurrencies,
      text,
    };
  }

  return {
    currencies: [],
    text: normalizedStatus,
  };
};

export const formatDisplayGeneralStatus = (params: {
  status: string | null | undefined;
  providesLabel: string;
}): string | null => {
  const parsed = parseProfileGeneralStatus(params.status);
  if (parsed.text && parsed.currencies.length > 0) {
    return `${parsed.text} - ${params.providesLabel} ${parsed.currencies.join(
      ", ",
    )}`;
  }

  if (parsed.text) return parsed.text;
  if (parsed.currencies.length === 0) return null;
  return `${params.providesLabel} ${parsed.currencies.join(", ")}`;
};

export const buildStatusFilterValue = (currency: string): string => {
  return `${STATUS_FILTER_PREFIX}${currency.trim().toUpperCase()}`;
};

export const isStatusFilterValue = (
  value: string | null | undefined,
): boolean => {
  return (value ?? "").startsWith(STATUS_FILTER_PREFIX);
};

export const parseStatusFilterValue = (
  value: string | null | undefined,
): string | null => {
  if (!isStatusFilterValue(value)) return null;
  const currency = (value ?? "").slice(STATUS_FILTER_PREFIX.length).trim();
  return currency || null;
};

export const buildProfileGeneralStatus = (params: {
  currencies: readonly ProfileStatusCurrency[];
  text: string | null | undefined;
}): string | null => {
  const text = asNonEmptyString(params.text);
  const selected = PROFILE_STATUS_CURRENCIES.filter((currency) =>
    params.currencies.includes(currency),
  );

  if (text && selected.length > 0) {
    return `${text}\n${selected.join(", ")}`;
  }

  if (text) return text;

  return selected.length > 0 ? selected.join(", ") : null;
};
