import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { resolveAllowTestMints } from "../lib/testMintGate";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced "Allow test mints" preference; unset follows the build default. */
export const useAllowTestMints = () => {
  const settingsRepository = useSettingsRepository();
  const allowTestMints = resolveAllowTestMints(useSetting("allowTestMints"));

  const setAllowTestMints = React.useCallback(
    (allow: boolean): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.allowTestMints",
        summary: `Allow test mints turned ${allow ? "on" : "off"}`,
        payload: { allowTestMints: allow },
      });
      return runWrite(settingsRepository.set("allowTestMints", allow));
    },
    [settingsRepository],
  );

  return { allowTestMints, setAllowTestMints };
};
