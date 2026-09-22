import type { I18nKey, Translate } from "../../i18n";
import {
  convertFiatToSat,
  convertSatToFiat,
  getDisplayUnitLabel,
  isFiatDisplayCurrency,
  type DisplayAmountParts,
  type DisplayCurrency,
  type FiatDisplayCurrency,
  type FiatRates,
} from "../../utils/displayAmounts";
import { formatInteger, normalizeLocale } from "../../utils/formatting";

/** The unit a recurring payment is fixed in: sats, or the fiat currency the user typed. */
export type RecurringAmountUnit = "sat" | FiatDisplayCurrency;

/**
 * A recurring payment's amount as the user set it. A fiat amount is stored in
 * hundredths (cents, haléře) and converted to sats at each run, so what goes
 * out follows the exchange rate instead of the day the payment was set up.
 */
export interface RecurringAmount {
  amount: number;
  unit: RecurringAmountUnit;
}

const FIAT_MINOR_PER_UNIT = 100;

export const isRecurringAmountUnit = (
  value: unknown,
): value is RecurringAmountUnit =>
  value === "sat" ||
  value === "czk" ||
  value === "eur" ||
  value === "chf" ||
  value === "usd";

export const isFiatRecurringAmount = (
  amount: RecurringAmount,
): amount is RecurringAmount & { unit: FiatDisplayCurrency } =>
  amount.unit !== "sat";

/** Whole fiat units of a fiat amount (150.50 for 15050 hundredths). */
export const recurringFiatValue = (amount: RecurringAmount): number =>
  amount.amount / FIAT_MINOR_PER_UNIT;

/** Sats a run would send at the given rates; null while a fiat amount has no rate. */
export const recurringAmountSat = (
  amount: RecurringAmount,
  fiatRates: FiatRates | null,
): number | null => {
  if (!isFiatRecurringAmount(amount)) return amount.amount;
  if (fiatRates === null) return null;
  const sat = convertFiatToSat(
    recurringFiatValue(amount),
    amount.unit,
    fiatRates,
  );
  return sat > 0 ? sat : null;
};

const parseDisplayValue = (value: string): number | null => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * What the amount keypad produced, fixed in the unit the user typed in: the
 * fiat text when a fiat currency is selected, otherwise the sat amount.
 */
export const recurringAmountFromInput = (input: {
  amountSat: string;
  displayCurrency: DisplayCurrency;
  displayValue: string | null;
  fiatRates: FiatRates | null;
}): RecurringAmount | null => {
  const sat = Number.parseInt(input.amountSat.trim(), 10);
  const hasSat = Number.isFinite(sat) && sat > 0;
  if (isFiatDisplayCurrency(input.displayCurrency)) {
    const typed =
      input.displayValue === null
        ? null
        : parseDisplayValue(input.displayValue);
    const fiatValue =
      typed ??
      (hasSat && input.fiatRates
        ? convertSatToFiat(sat, input.displayCurrency, input.fiatRates)
        : null);
    if (fiatValue === null) return null;
    const minor = Math.round(fiatValue * FIAT_MINOR_PER_UNIT);
    return minor > 0 ? { amount: minor, unit: input.displayCurrency } : null;
  }
  return hasSat ? { amount: sat, unit: "sat" } : null;
};

const fiatFormatters = new Map<string, Intl.NumberFormat>();

const formatFiat = (value: number, lang: string | undefined): string => {
  const locale = normalizeLocale(lang);
  let formatter = fiatFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    fiatFormatters.set(locale, formatter);
  }
  return formatter.format(value);
};

export interface RecurringAmountDisplayOptions {
  displayCurrency: DisplayCurrency;
  fiatRates: FiatRates | null;
  /** The app's sat formatter for the selected display unit. */
  formatSat: (amountSat: number) => DisplayAmountParts;
  lang?: string;
}

/**
 * The amount in the selected display unit. Exact when the payment is fixed
 * in that unit; otherwise a conversion, marked approximate the way every
 * other converted amount in the app is.
 */
export const formatRecurringAmountParts = (
  amount: RecurringAmount,
  options: RecurringAmountDisplayOptions,
): DisplayAmountParts => {
  if (options.displayCurrency === "hidden") return options.formatSat(0);
  if (
    isFiatRecurringAmount(amount) &&
    amount.unit === options.displayCurrency
  ) {
    return {
      amountText: formatFiat(recurringFiatValue(amount), options.lang),
      approxPrefix: "",
      unitLabel: getDisplayUnitLabel(amount.unit, options.lang),
    };
  }
  const sat = recurringAmountSat(amount, options.fiatRates);
  if (sat === null) {
    return {
      amountText: "…",
      approxPrefix: "",
      unitLabel: getDisplayUnitLabel(options.displayCurrency, options.lang),
    };
  }
  const parts = options.formatSat(sat);
  return isFiatRecurringAmount(amount) && parts.approxPrefix === ""
    ? { ...parts, approxPrefix: "~" }
    : parts;
};

export const formatRecurringAmountText = (
  amount: RecurringAmount,
  options: RecurringAmountDisplayOptions,
): string => {
  const parts = formatRecurringAmountParts(amount, options);
  return [`${parts.approxPrefix}${parts.amountText}`, parts.unitLabel.trim()]
    .filter(Boolean)
    .join(" ");
};

const APPROX_SAT_KEY: I18nKey = "recurringApproxSat";

/**
 * The other side of a fixed amount: the sats a fiat payment converts to right
 * now. Null for sat payments, whose fiat side the display unit already shows.
 */
export const recurringAmountSecondaryText = (
  amount: RecurringAmount,
  fiatRates: FiatRates | null,
  lang: string | undefined,
  t: Translate,
): string | null => {
  if (!isFiatRecurringAmount(amount)) return null;
  const sat = recurringAmountSat(amount, fiatRates);
  if (sat === null) return null;
  return t(APPROX_SAT_KEY).replace("{amount}", formatInteger(sat, lang));
};
