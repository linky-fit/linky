import { parseProfileGeneralStatus } from "@linky-fit/proxy-payment";

export {
  buildProfileGeneralStatus,
  parseProfileGeneralStatus,
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
} from "@linky-fit/proxy-payment";

const STATUS_FILTER_PREFIX = "status:";

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
