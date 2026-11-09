import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced "Pass contacts' listings on" switch; unset is on. */
export const usePassOnListings = () => {
  const settingsRepository = useSettingsRepository();
  const passOnListings = useSetting("passOnListings") ?? true;

  const setPassOnListings = React.useCallback(
    (enabled: boolean): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.passOnListings",
        summary: `Passing contacts' listings on turned ${enabled ? "on" : "off"}`,
        payload: { passOnListings: enabled },
      });
      return runWrite(settingsRepository.set("passOnListings", enabled));
    },
    [settingsRepository],
  );

  return { passOnListings, setPassOnListings };
};
