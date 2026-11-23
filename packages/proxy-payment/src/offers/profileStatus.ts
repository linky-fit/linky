import type { ListingsDocument } from "@linky-fit/linkstr";
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

const VALID_PROFILE_STATUS_CURRENCIES = new Set<string>([
  ...PROFILE_STATUS_CURRENCIES,
  ...LEGACY_PROFILE_STATUS_CURRENCIES,
]);
const SUPPORTED_PROFILE_STATUS_CURRENCIES = new Set<string>(
  PROFILE_STATUS_CURRENCIES,
);

const parseLinkyProfileExchangeStatus = (
  status: string | null | undefined,
): ProfileStatusCurrency[] | null => {
  const parts = parseCurrencyStatusCodes(status);
  if (!parts) return null;

  if (!parts.every((part) => VALID_PROFILE_STATUS_CURRENCIES.has(part))) {
    return null;
  }

  return parts.filter((part): part is ProfileStatusCurrency =>
    SUPPORTED_PROFILE_STATUS_CURRENCIES.has(part),
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
  const lastIndex = lines.length - 1;
  const maybeCurrencies = parseLinkyProfileExchangeStatus(lines[lastIndex]);
  if (maybeCurrencies) {
    return {
      currencies: maybeCurrencies,
      text: nonEmpty(lines.slice(0, lastIndex).join("\n")),
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

/**
 * The currencies someone pays bank transfers in for their contacts: those
 * their listings document names when it names any list, an empty one
 * included, else those of their general status, which authors on older
 * releases still advertise them in. Unsupported codes are dropped.
 */
export const advertisedProxyPaymentCurrencies = (
  document: Pick<ListingsDocument, "proxyPaymentCurrencies"> | null,
  status: string | null | undefined,
): ProfileStatusCurrency[] => {
  const listed = document?.proxyPaymentCurrencies;
  if (listed === undefined) return parseProfileGeneralStatus(status).currencies;
  return PROFILE_STATUS_CURRENCIES.filter((currency) =>
    listed.includes(currency),
  );
};
