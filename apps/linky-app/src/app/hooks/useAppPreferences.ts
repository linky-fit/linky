import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY } from "../../utils/constants";
import { safeLocalStorageSet } from "../../utils/storage";
import { allowedDisplayCurrenciesAtom } from "../state/shell/displayPrefs";

/** Mirrors the synced display currencies into device storage; mounted once by the shell. */
export const useAppPreferences = (): void => {
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  React.useEffect(() => {
    safeLocalStorageSet(
      DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
      JSON.stringify(allowedDisplayCurrencies),
    );
  }, [allowedDisplayCurrencies]);
};
