import type { SettingValues } from "@linky-fit/linksync";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { I18nKey } from "../../i18n";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

export type SupporterBadgeDisplay = SettingValues["supporterBadgeDisplay"];

export const SUPPORTER_BADGE_DISPLAYS: ReadonlyArray<SupporterBadgeDisplay> = [
  "tier",
  "generic",
  "hide",
];

export const SUPPORTER_BADGE_DISPLAY_LABEL_KEYS = {
  tier: "supporterBadgeDisplayTier",
  generic: "supporterBadgeDisplayGeneric",
  hide: "supporterBadgeDisplayHide",
} as const satisfies Record<SupporterBadgeDisplay, I18nKey>;

/** The synced choice of which supporter badge to publish; the tier while unset. */
export const useSupporterBadgeDisplay = () => {
  const settingsRepository = useSettingsRepository();
  const display = useSetting("supporterBadgeDisplay") ?? "tier";

  const setDisplay = React.useCallback(
    (next: SupporterBadgeDisplay): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "settings.supporterBadgeDisplay",
        summary: `Supporter badge display set to ${next}`,
        payload: { supporterBadgeDisplay: next },
      });
      return runWrite(settingsRepository.set("supporterBadgeDisplay", next));
    },
    [settingsRepository],
  );

  return { display, setDisplay };
};
