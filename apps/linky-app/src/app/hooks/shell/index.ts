import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  translations,
  type I18nKey,
  type Lang,
  type Translate,
} from "../../../i18n";
import { writeClipboardText } from "../../../platform/clipboard";
import {
  applyAmountInputKey,
  applyAmountInputKeyWithDraft,
  formatDisplayAmountParts,
  formatDisplayAmountText,
  getDisplayUnitLabel,
  getNextDisplayCurrency,
  isFiatDisplayCurrency,
} from "../../../utils/displayAmounts";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import {
  allowedDisplayCurrenciesAtom,
  displayPrefsAtom,
  fiatRatesAtom,
} from "../../state/shell/displayPrefs";
import {
  paidOverlayAtom,
  paidOverlayCommandsAtom,
} from "../../state/shell/paidOverlay";
import { statusAtom } from "../../state/shell/status";
import { toastCommandsAtom } from "../../state/shell/toasts";

// The page-facing shell: copy, amounts, statuses, toasts and the paid
// overlay. Screens import these from this module, so tests mock it once.

export const useTranslation = (): { lang: Lang; t: Translate } => {
  const lang = useAtomValue(displayPrefsAtom, (prefs) => prefs.lang);
  const t = React.useCallback(
    (key: I18nKey) => translations[lang][key],
    [lang],
  );
  return { lang, t };
};

/** Amounts in the user's display currency, and the amount keypad's input rules. */
export const useDisplayAmounts = () => {
  const { decimalAmountInputEnabled, displayCurrency, lang } =
    useAtomValue(displayPrefsAtom);
  const fiatRates = useAtomValue(fiatRatesAtom);
  return React.useMemo(() => {
    const options = { displayCurrency, fiatRates, lang };
    // Bitcoin amounts are fractions, so ₿ always takes decimals.
    const decimalAmountInputKeyVisible =
      displayCurrency === "btc" ||
      (decimalAmountInputEnabled &&
        isFiatDisplayCurrency(displayCurrency) &&
        fiatRates !== null);
    return {
      applyAmountInputKey: (currentAmount: string, key: string) =>
        applyAmountInputKey(currentAmount, key, options),
      applyAmountInputKeyWithDraft: (
        currentAmount: string,
        currentDisplayValue: string | null,
        key: string,
      ) =>
        applyAmountInputKeyWithDraft(
          currentAmount,
          currentDisplayValue,
          key,
          options,
          decimalAmountInputKeyVisible,
        ),
      decimalAmountInputEnabled,
      decimalAmountInputKeyVisible,
      displayCurrency,
      displayUnit: getDisplayUnitLabel(displayCurrency, lang),
      fiatRates,
      formatDisplayedAmountParts: (amountSat: number) =>
        formatDisplayAmountParts(amountSat, options),
      formatDisplayedAmountText: (amountSat: number) =>
        formatDisplayAmountText(amountSat, options),
    };
  }, [decimalAmountInputEnabled, displayCurrency, fiatRates, lang]);
};

/** The display currencies enabled in Settings, and a step to the next one. */
export const useDisplayCurrencyCycle = () => {
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  const setPrefs = useAtomSet(displayPrefsAtom);
  const cycleDisplayCurrency = React.useCallback(
    () =>
      setPrefs((prefs) => ({
        ...prefs,
        displayCurrency: getNextDisplayCurrency(
          prefs.displayCurrency,
          allowedDisplayCurrencies,
        ),
      })),
    [allowedDisplayCurrencies, setPrefs],
  );
  return { allowedDisplayCurrencies, cycleDisplayCurrency };
};

/** Reports a status line, shown as a toast. */
export const useSetStatus = () => useAtomSet(statusAtom);

export const usePushToast = () => useAtomValue(toastCommandsAtom).pushToast;

export const useCopyText = (): ((value: string) => Promise<void>) => {
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(
    async (value: string) => {
      try {
        const copied = await writeClipboardText(value);
        pushToast(t(copied ? "copiedToClipboard" : "copyFailed"));
      } catch {
        pushToast(t("copyFailed"));
      }
    },
    [pushToast, t],
  );
};

/** Opens and settles the paid overlay; `showPaidOverlay` titles it "Paid" unless told otherwise. */
export const usePaidOverlayCommands = () => {
  const commands = useAtomValue(paidOverlayCommandsAtom);
  const { t } = useTranslation();
  const showPaidOverlay = React.useCallback(
    (title?: string, details?: PaidOverlayDetails) =>
      commands.showPaid(title ?? t("paid"), details ?? null),
    [commands, t],
  );
  return {
    dismissPaymentSending: commands.dismissPaymentSending,
    showPaidOverlay,
    showPaymentSending: commands.showPaymentSending,
  };
};

/** The paid overlay as the layout renders it. */
export const usePaidOverlay = () => {
  const overlay = useAtomValue(paidOverlayAtom);
  return {
    paidOverlayDetails: overlay?.details ?? null,
    paidOverlayIsOpen: overlay !== null,
    paidOverlayPhase: overlay?.phase ?? "done",
    paidOverlayTitle: overlay?.title ?? null,
  };
};
