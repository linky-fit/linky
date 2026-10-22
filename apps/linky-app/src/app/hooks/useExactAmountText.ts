import React from "react";
import {
  formatDisplayAmountParts,
  formatDisplayAmountText,
  isFiatDisplayCurrency,
} from "../../utils/displayAmounts";
import { useDisplayAmounts, useTranslation } from "./shell";

/**
 * Amounts that must be exact, such as on-chain amounts and a payment's debit:
 * `sats` and `btc` always in that unit, `fiat` the display value beside the
 * sats when the display unit is fiat, `exact` in the display unit with the
 * sats beside a fiat value.
 */
export const useExactAmountText = () => {
  const { lang } = useTranslation();
  const { displayCurrency, fiatRates, formatDisplayedAmountText } =
    useDisplayAmounts();
  return React.useMemo(() => {
    const satOptions = {
      displayCurrency: "sat",
      fiatRates: null,
      lang,
    } as const;
    const sats = (amountSat: number) =>
      formatDisplayAmountText(amountSat, satOptions);
    const fiat = (amountSat: number): string | null =>
      isFiatDisplayCurrency(displayCurrency) && fiatRates !== null
        ? formatDisplayedAmountText(amountSat)
        : null;
    return {
      sats,
      satParts: (amountSat: number) =>
        formatDisplayAmountParts(amountSat, satOptions),
      btc: (amountSat: number) =>
        formatDisplayAmountText(amountSat, {
          displayCurrency: "btc",
          fiatRates: null,
          lang,
        }),
      fiat,
      exact: (amountSat: number) => {
        const fiatText = fiat(amountSat);
        return fiatText === null
          ? formatDisplayedAmountText(amountSat)
          : `${sats(amountSat)} (${fiatText})`;
      },
    };
  }, [displayCurrency, fiatRates, formatDisplayedAmountText, lang]);
};
