import { vi } from "vitest";
import type * as Shell from "../app/hooks/shell";
import type { PaidOverlayDetails } from "../app/lib/paidOverlay";
import type { PushToast } from "../app/state/shell/toasts";
import type { I18nKey, Lang } from "../i18n";
import {
  applyAmountInputKey,
  applyAmountInputKeyWithDraft,
  formatDisplayAmountParts,
  formatDisplayAmountText,
  type DisplayAmountParts,
  type DisplayCurrency,
  type FiatRates,
} from "../utils/displayAmounts";

interface ShellHooksMockOptions {
  allowedDisplayCurrencies?: readonly DisplayCurrency[];
  copyText?: (value: string) => Promise<void>;
  cycleDisplayCurrency?: () => void;
  displayCurrency?: DisplayCurrency;
  displayUnit?: string;
  fiatRates?: FiatRates | null;
  formatDisplayedAmountParts?: (amountSat: number) => DisplayAmountParts;
  formatDisplayedAmountText?: (amountSat: number) => string;
  lang?: Lang;
  pushToast?: PushToast;
  setStatus?: ReturnType<typeof Shell.useSetStatus>;
  showPaidOverlay?: (title?: string, details?: PaidOverlayDetails) => void;
  t?: (key: I18nKey) => string;
}

/**
 * The `app/hooks/shell` module for `vi.mock`: copy as its i18n keys and
 * amounts as `<n> sat` unless overridden; a `displayCurrency` formats them
 * as the app does. Pass functions that read
 * test-local values lazily; the mock is built before the test module's own
 * constants.
 */
export const shellHooksMock = (
  options: ShellHooksMockOptions = {},
): typeof Shell => {
  const t = options.t ?? ((key: I18nKey) => key);
  const displayCurrency = options.displayCurrency ?? "sat";
  const fiatRates = options.fiatRates ?? null;
  const amountOptions = {
    displayCurrency,
    fiatRates,
    lang: options.lang ?? "en",
  };
  const formatsLikeApp = options.displayCurrency !== undefined;
  const formatDisplayedAmountParts =
    options.formatDisplayedAmountParts ??
    (formatsLikeApp
      ? (amountSat: number) =>
          formatDisplayAmountParts(amountSat, amountOptions)
      : (amountSat: number) => ({
          approxPrefix: "",
          amountText: String(amountSat),
          unitLabel: "sat",
        }));
  const cycleDisplayCurrency = options.cycleDisplayCurrency ?? vi.fn();
  const setStatus = options.setStatus ?? vi.fn();
  const pushToast = options.pushToast ?? vi.fn();
  const copyText = options.copyText ?? vi.fn(async () => {});
  const paidOverlayCommands = {
    dismissPaymentSending: vi.fn(),
    showPaidOverlay: options.showPaidOverlay ?? vi.fn(),
    showPaymentSending: vi.fn(),
  };
  const displayAmounts = {
    applyAmountInputKey: (currentAmount: string, key: string) =>
      applyAmountInputKey(currentAmount, key, amountOptions),
    applyAmountInputKeyWithDraft: (
      currentAmount: string,
      currentDisplayValue: string | null,
      key: string,
    ) =>
      applyAmountInputKeyWithDraft(
        currentAmount,
        currentDisplayValue,
        key,
        amountOptions,
        false,
      ),
    decimalAmountInputEnabled: false,
    decimalAmountInputKeyVisible: false,
    displayCurrency,
    displayUnit: options.displayUnit ?? "sat",
    fiatRates,
    formatDisplayedAmountParts,
    formatDisplayedAmountText:
      options.formatDisplayedAmountText ??
      (formatsLikeApp
        ? (amountSat: number) =>
            formatDisplayAmountText(amountSat, amountOptions)
        : (amountSat: number) => `${amountSat} sat`),
  };
  return {
    useTranslation: () => ({ lang: options.lang ?? "en", t }),
    useDisplayAmounts: () => displayAmounts,
    useDisplayCurrencyCycle: () => ({
      allowedDisplayCurrencies: [
        ...(options.allowedDisplayCurrencies ?? ["sat"]),
      ],
      cycleDisplayCurrency,
    }),
    useSetStatus: () => setStatus,
    usePushToast: () => pushToast,
    useCopyText: () => copyText,
    usePaidOverlayCommands: () => paidOverlayCommands,
    usePaidOverlay: () => ({
      paidOverlayDetails: null,
      paidOverlayIsOpen: false,
      paidOverlayPhase: "done",
      paidOverlayTitle: null,
    }),
  };
};
