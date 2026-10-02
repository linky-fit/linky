import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced "arm the bolt card on Send" switch; unset means off. */
export const useBoltCardArmOnSend = () => {
  const settingsRepository = useSettingsRepository();
  const armOnSend = useSetting("boltCard.armOnSend") === true;

  const setArmOnSend = React.useCallback(
    (arm: boolean): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.boltCardArmOnSend",
        summary: `Bolt card on Send turned ${arm ? "on" : "off"}`,
        payload: { armOnSend: arm },
      });
      return runWrite(settingsRepository.set("boltCard.armOnSend", arm));
    },
    [settingsRepository],
  );

  return { armOnSend, setArmOnSend };
};
