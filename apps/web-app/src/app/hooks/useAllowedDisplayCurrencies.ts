import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { DisplayCurrency } from "../../utils/displayAmounts";
import { getInitialAllowedDisplayCurrencies } from "../../utils/storage";
import {
  resolveDisplayCurrencies,
  toggleDisplayCurrency,
} from "../lib/displayCurrenciesSetting";
import { runWrite } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The display currencies enabled in Settings, synced across the user's devices. */
export const useAllowedDisplayCurrencies = () => {
  const settingsRepository = useSettingsRepository();
  const [deviceCurrencies] = React.useState(getInitialAllowedDisplayCurrencies);
  const synced = useSetting("displayCurrencies");
  const allowedDisplayCurrencies = React.useMemo(
    () => resolveDisplayCurrencies(synced, deviceCurrencies),
    [deviceCurrencies, synced],
  );

  const toggleAllowedDisplayCurrency = React.useCallback(
    (currency: DisplayCurrency) => {
      const next = toggleDisplayCurrency(allowedDisplayCurrencies, currency);
      if (next === allowedDisplayCurrencies) return;
      reportAppLog({
        tag: "settings.displayCurrencies",
        summary: `Display currencies set to ${next.join(", ")}`,
        payload: { displayCurrencies: next },
      });
      void runWrite(settingsRepository.set("displayCurrencies", next));
    },
    [allowedDisplayCurrencies, settingsRepository],
  );

  return { allowedDisplayCurrencies, toggleAllowedDisplayCurrency };
};
