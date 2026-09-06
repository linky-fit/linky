import React from "react";
import type {
  AdvancedSettingsContextValue,
  EvoluSettingsContextValue,
  MintSettingsContextValue,
  RelaySettingsContextValue,
} from "../../context/SystemSettingsContexts";
import { useMemoizedContextValue } from "./useMemoizedRouteBundle";
import type { Translate } from "../../../i18n";

type EvoluSettingsInput = Omit<
  EvoluSettingsContextValue,
  "clearDatabaseArmed" | "requestClearDatabase"
>;

interface UseSystemSettingsCompositionParams {
  advancedSettingsInput: AdvancedSettingsContextValue;
  evoluSettingsInput: EvoluSettingsInput;
  mintSettingsInput: MintSettingsContextValue;
  relaySettingsInput: RelaySettingsContextValue;
  t: Translate;
}

export interface SystemSettingsCompositionResult {
  advancedSettingsContext: AdvancedSettingsContextValue;
  evoluSettingsContext: EvoluSettingsContextValue;
  mintSettingsContext: MintSettingsContextValue;
  relaySettingsContext: RelaySettingsContextValue;
}

export const useSystemSettingsComposition = ({
  advancedSettingsInput,
  evoluSettingsInput,
  mintSettingsInput,
  relaySettingsInput,
  t,
}: UseSystemSettingsCompositionParams): SystemSettingsCompositionResult => {
  const [clearDatabaseArmed, setClearDatabaseArmed] = React.useState(false);
  const { pushToast } = advancedSettingsInput;
  const { wipeEvoluStorage } = evoluSettingsInput;

  const requestClearDatabase = React.useCallback(() => {
    if (!clearDatabaseArmed) {
      setClearDatabaseArmed(true);
      pushToast(t("deleteArmedHint"));
      return;
    }

    setClearDatabaseArmed(false);
    void wipeEvoluStorage();
  }, [clearDatabaseArmed, pushToast, t, wipeEvoluStorage]);

  React.useEffect(() => {
    if (!clearDatabaseArmed) return;

    const timeoutId = window.setTimeout(() => {
      setClearDatabaseArmed(false);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearDatabaseArmed]);

  return {
    advancedSettingsContext: useMemoizedContextValue(advancedSettingsInput),
    evoluSettingsContext: useMemoizedContextValue({
      ...evoluSettingsInput,
      clearDatabaseArmed,
      requestClearDatabase,
    }),
    mintSettingsContext: useMemoizedContextValue(mintSettingsInput),
    relaySettingsContext: useMemoizedContextValue(relaySettingsInput),
  };
};
