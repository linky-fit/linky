import { Stack, ListRow } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useColorModePreference } from "../hooks/useColorMode";
import {
  COLOR_MODE_PREFERENCE_LABEL_KEYS,
  COLOR_MODE_PREFERENCES,
  setColorModePreference,
} from "../utils/colorMode";

export function AppearancePage(): React.ReactElement {
  const { t } = useAppShellCore();
  const preference = useColorModePreference();

  return (
    <Stack>
      {COLOR_MODE_PREFERENCES.map((option) => (
        <ListRow
          key={option}
          title={t(COLOR_MODE_PREFERENCE_LABEL_KEYS[option])}
          selected={preference === option}
          onPress={() => setColorModePreference(option)}
          chevron={false}
        />
      ))}
    </Stack>
  );
}
