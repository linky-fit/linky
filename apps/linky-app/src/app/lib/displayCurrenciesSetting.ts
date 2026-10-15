import {
  normalizeAllowedDisplayCurrencies,
  type DisplayCurrency,
} from "../../utils/displayAmounts";

/** The synced list wins; unset follows the list this device stored locally. */
export const resolveDisplayCurrencies = (
  synced: readonly string[] | null,
  deviceCurrencies: DisplayCurrency[],
): DisplayCurrency[] =>
  synced === null
    ? deviceCurrencies
    : normalizeAllowedDisplayCurrencies(synced, deviceCurrencies[0] ?? "sat");

/** Returns `current` itself when the toggle would leave no currency enabled. */
export const toggleDisplayCurrency = (
  current: DisplayCurrency[],
  currency: DisplayCurrency,
): DisplayCurrency[] => {
  if (!current.includes(currency)) {
    return normalizeAllowedDisplayCurrencies(
      current.concat(currency),
      currency,
    );
  }
  if (current.length <= 1) return current;
  return current.filter((candidate) => candidate !== currency);
};
