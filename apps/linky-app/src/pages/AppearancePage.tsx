import { ListRow, Section } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useColorModePreference } from "../hooks/useColorMode";
import {
  COLOR_MODE_PREFERENCE_LABEL_KEYS,
  COLOR_MODE_PREFERENCES,
  setColorModePreference,
} from "../utils/colorMode";

export function AppearancePage(): React.ReactElement {
  const { t } = useTranslation();
  const preference = useColorModePreference();

  return (
    <Section grouped>
      {COLOR_MODE_PREFERENCES.map((option) => (
        <ListRow
          key={option}
          title={t(COLOR_MODE_PREFERENCE_LABEL_KEYS[option])}
          selected={preference === option}
          onPress={() => setColorModePreference(option)}
          chevron={false}
        />
      ))}
    </Section>
  );
}
