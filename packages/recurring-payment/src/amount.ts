export const FIAT_RECURRING_UNITS = ["czk", "eur", "chf", "usd"] as const;
export type FiatRecurringUnit = (typeof FIAT_RECURRING_UNITS)[number];

/** The unit a recurring payment is fixed in: sats, or the fiat currency the user typed. */
export type RecurringAmountUnit = "sat" | FiatRecurringUnit;

/**
 * A recurring payment's amount as the user set it. A fiat amount is stored in
 * hundredths (cents, haléře) and converted to sats at each run, so what goes
 * out follows the exchange rate instead of the day the payment was set up.
 */
export interface RecurringAmount {
  amount: number;
  unit: RecurringAmountUnit;
}

/** Exchange rates as BTC prices per fiat unit; linkshu's `FiatRates` fits. */
export type FiatRatesPerBtc = Readonly<
  Record<`${FiatRecurringUnit}PerBtc`, number>
>;

const FIAT_MINOR_PER_UNIT = 100;
const SATS_PER_BTC = 100_000_000;

export const isRecurringAmountUnit = (
  value: unknown,
): value is RecurringAmountUnit =>
  value === "sat" || FIAT_RECURRING_UNITS.some((unit) => unit === value);

export const isFiatRecurringAmount = (
  amount: RecurringAmount,
): amount is RecurringAmount & { unit: FiatRecurringUnit } =>
  amount.unit !== "sat";

/** Whole fiat units of a fiat amount (150.50 for 15050 hundredths). */
export const recurringFiatValue = (amount: RecurringAmount): number =>
  amount.amount / FIAT_MINOR_PER_UNIT;

/** Hundredths for a fiat value the user typed; null unless it rounds to a positive amount. */
export const fiatRecurringAmount = (
  value: number,
  unit: FiatRecurringUnit,
): RecurringAmount | null => {
  const minor = Math.round(value * FIAT_MINOR_PER_UNIT);
  return Number.isFinite(minor) && minor > 0 ? { amount: minor, unit } : null;
};

/** Sats a run would send at the given rates; null while a fiat amount has no rate. */
export const recurringAmountSat = (
  amount: RecurringAmount,
  fiatRates: FiatRatesPerBtc | null,
): number | null => {
  if (!isFiatRecurringAmount(amount)) return amount.amount;
  if (fiatRates === null) return null;
  const sat = Math.round(
    (recurringFiatValue(amount) / fiatRates[`${amount.unit}PerBtc`]) *
      SATS_PER_BTC,
  );
  return Number.isFinite(sat) && sat > 0 ? sat : null;
};
