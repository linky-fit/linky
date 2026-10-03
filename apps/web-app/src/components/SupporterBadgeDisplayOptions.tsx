import { ListRow, Stack } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import {
  SUPPORTER_BADGE_DISPLAY_LABEL_KEYS,
  SUPPORTER_BADGE_DISPLAYS,
  useSupporterBadgeDisplay,
} from "../app/hooks/useSupporterBadgeDisplay";

/** Which supporter badge contacts see: the tier, a generic Supporter badge, or none. */
export function SupporterBadgeDisplayOptions(): React.ReactElement {
  const { t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();
  const { display, setDisplay } = useSupporterBadgeDisplay();

  return (
    <Stack>
      {SUPPORTER_BADGE_DISPLAYS.map((option) => (
        <ListRow
          key={option}
          title={t(SUPPORTER_BADGE_DISPLAY_LABEL_KEYS[option])}
          selected={display === option}
          chevron={false}
          onPress={() =>
            void setDisplay(option).then((outcome) => {
              if (!outcome.ok) pushToast(outcome.error);
            })
          }
        />
      ))}
    </Stack>
  );
}
