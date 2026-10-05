import { BANK_PAYMENT_OFFER_CURRENCIES } from "../bankQr/bankPayment";

/**
 * The general (kind 30315, `d=general`) status Linky publishes: free text, and
 * on its last line the comma-separated currencies the user provides as proxy payments.
 */

const nonEmpty = (value: string | null | undefined): string | null =>
  value?.trim() || null;

// The currencies a user can offer to pay for friends (proxy payments).
// Older statuses may still carry BTC or USD; both parse and are dropped.
export const PROFILE_STATUS_CURRENCIES = BANK_PAYMENT_OFFER_CURRENCIES;
const LEGACY_PROFILE_STATUS_CURRENCIES = ["BTC", "USD"] as const;

export type ProfileStatusCurrency = (typeof PROFILE_STATUS_CURRENCIES)[number];

interface ParsedProfileGeneralStatus {
  currencies: ProfileStatusCurrency[];
  text: string | null;
}

const CURRENCY_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

const parseCurrencyStatusCodes = (
  status: string | null | undefined,
): string[] | null => {
  const normalizedStatus = nonEmpty(status);
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
  const normalizedStatus = nonEmpty(status);
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

    const text = nonEmpty(lines.slice(0, index).join("\n"));
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

export const buildProfileGeneralStatus = (params: {
  currencies: readonly ProfileStatusCurrency[];
  text: string | null | undefined;
}): string | null => {
  const text = nonEmpty(params.text);
  const selected = PROFILE_STATUS_CURRENCIES.filter((currency) =>
    params.currencies.includes(currency),
  );

  if (text && selected.length > 0) {
    return `${text}\n${selected.join(", ")}`;
  }

  if (text) return text;

  return selected.length > 0 ? selected.join(", ") : null;
};
