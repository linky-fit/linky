import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced "Experimental features" switch; unset is off. */
export const useExperimentalFeatures = () => {
  const settingsRepository = useSettingsRepository();
  const experimentalFeatures = useSetting("experimentalFeatures") ?? false;

  const setExperimentalFeatures = React.useCallback(
    (enabled: boolean): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.experimentalFeatures",
        summary: `Experimental features turned ${enabled ? "on" : "off"}`,
        payload: { experimentalFeatures: enabled },
      });
      return runWrite(settingsRepository.set("experimentalFeatures", enabled));
    },
    [settingsRepository],
  );

  return { experimentalFeatures, setExperimentalFeatures };
};
