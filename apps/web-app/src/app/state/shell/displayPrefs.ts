import { decodeFiatRates } from "@linky-fit/linkshu";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  DECIMAL_AMOUNT_INPUT_STORAGE_KEY,
  DISPLAY_CURRENCY_STORAGE_KEY,
  FIAT_RATES_CACHE_STORAGE_KEY,
  UNIT_TOGGLE_STORAGE_KEY,
} from "../../../utils/constants";
import type { DisplayCurrency, FiatRates } from "../../../utils/displayAmounts";
import { readStoredLang, storeLang, type Lang } from "../../../utils/lang";
import {
  getInitialAllowedDisplayCurrencies,
  getInitialDecimalAmountInputEnabled,
  getInitialDisplayCurrency,
} from "../../../utils/storage";
import { resolveDisplayCurrencies } from "../../lib/displayCurrenciesSetting";
import { kvSeededAtom, platformAtom } from "../platform";
import { liveSettingAtom } from "../session/settings";

export interface DisplayPrefs {
  readonly lang: Lang;
  readonly displayCurrency: DisplayCurrency;
  readonly decimalAmountInputEnabled: boolean;
}

/** How amounts and copy are shown on this device. */
export const displayPrefsAtom = kvSeededAtom(
  (kv): DisplayPrefs => ({
    lang: readStoredLang(kv),
    displayCurrency: getInitialDisplayCurrency(kv),
    decimalAmountInputEnabled: getInitialDecimalAmountInputEnabled(kv),
  }),
  (kv, prefs) => {
    storeLang(kv, prefs.lang);
    kv.setItem(DISPLAY_CURRENCY_STORAGE_KEY, prefs.displayCurrency);
    kv.setItem(
      UNIT_TOGGLE_STORAGE_KEY,
      prefs.displayCurrency === "btc" ? "1" : "0",
    );
    kv.setItem(
      DECIMAL_AMOUNT_INPUT_STORAGE_KEY,
      prefs.decimalAmountInputEnabled ? "1" : "0",
    );
  },
  { persistSeed: true },
);

// Read once per page: later writes of the device list only mirror the resolved one.
const deviceDisplayCurrenciesAtom = Atom.keepAlive(
  Atom.readable((get) =>
    getInitialAllowedDisplayCurrencies(get(platformAtom).kv),
  ),
);

const displayCurrenciesSettingAtom = liveSettingAtom("displayCurrencies");

/** The display currencies enabled in Settings, synced across the user's devices. */
export const allowedDisplayCurrenciesAtom = Atom.readable((get) =>
  resolveDisplayCurrencies(
    Option.getOrNull(AsyncResult.value(get(displayCurrenciesSettingAtom))),
    get(deviceDisplayCurrenciesAtom),
  ),
);

/** The fiat rates last fetched on this device; `useFiatRatesSync` refreshes them. */
export const fiatRatesAtom = kvSeededAtom((kv): FiatRates | null =>
  decodeFiatRates(kv.getItem(FIAT_RATES_CACHE_STORAGE_KEY)),
);
