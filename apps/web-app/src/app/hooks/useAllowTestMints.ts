import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import {
  ALLOW_TEST_MINTS_SETTING_KEY,
  encodeAllowTestMints,
  resolveAllowTestMints,
} from "../lib/testMintGate";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced "Allow test mints" preference; unset follows the build default. */
export const useAllowTestMints = () => {
  const settingsRepository = useSettingsRepository();
  const allowTestMints = resolveAllowTestMints(
    useSetting(ALLOW_TEST_MINTS_SETTING_KEY),
  );

  const setAllowTestMints = React.useCallback(
    (allow: boolean): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.allowTestMints",
        summary: `Allow test mints turned ${allow ? "on" : "off"}`,
        payload: { allowTestMints: allow },
      });
      return runWrite(
        settingsRepository.set(
          ALLOW_TEST_MINTS_SETTING_KEY,
          encodeAllowTestMints(allow),
        ),
      );
    },
    [settingsRepository],
  );

  return { allowTestMints, setAllowTestMints };
};
