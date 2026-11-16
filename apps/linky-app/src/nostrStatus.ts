import { parseProfileGeneralStatus } from "@linky-fit/proxy-payment";

export {
  buildProfileGeneralStatus,
  parseProfileGeneralStatus,
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
} from "@linky-fit/proxy-payment";

const STATUS_FILTER_PREFIX = "status:";

/** The status's free text with the proxy payment currencies, which come from wherever the contact offers them. */
export const formatDisplayGeneralStatus = (params: {
  status: string | null | undefined;
  currencies: ReadonlyArray<string>;
  providesLabel: string;
}): string | null => {
  const { text } = parseProfileGeneralStatus(params.status);
  const { currencies } = params;
  if (text && currencies.length > 0) {
    return `${text} - ${params.providesLabel} ${currencies.join(", ")}`;
  }

  if (text) return text;
  if (currencies.length === 0) return null;
  return `${params.providesLabel} ${currencies.join(", ")}`;
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
