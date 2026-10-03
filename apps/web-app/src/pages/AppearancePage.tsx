import {
  ListRow,
  Section,
  Stack,
  SupporterBadge,
  THEME_PALETTES,
  type ThemePalette,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useSupporterContext } from "../app/context/SupporterContext";
import {
  linkyBotPubkey,
  SUPPORTER_TIER_LABEL_KEYS,
} from "../app/lib/supporter";
import { reportAppLog } from "../devtools/inspector/appLog";
import { useColorModePreference } from "../hooks/useColorMode";
import {
  useThemePalette,
  useUnlockedSupporterTier,
} from "../hooks/useThemePalette";
import {
  COLOR_MODE_PREFERENCE_LABEL_KEYS,
  COLOR_MODE_PREFERENCES,
  setColorModePreference,
} from "../utils/colorMode";
import {
  isPaletteUnlocked,
  paletteUnlockTier,
  setThemePalettePreference,
} from "../utils/themePalette";

const selectPalette = (palette: ThemePalette): void => {
  setThemePalettePreference(palette);
  reportAppLog({
    tag: "settings.themePalette",
    summary: `Theme set to ${palette}`,
    payload: { palette },
  });
};

export function AppearancePage(): React.ReactElement {
  const { t } = useAppShellCore();
  const { openDonate } = useSupporterContext();
  const preference = useColorModePreference();
  const palette = useThemePalette();
  const unlockedTier = useUnlockedSupporterTier();

  return (
    <Stack gap="$lg">
      <Section title={t("appearanceColorMode")}>
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
      {/* Until Linky Bot launches no palette can be unlocked, so Default is the only theme. */}
      {linkyBotPubkey === null ? null : (
        <Section title={t("appearanceTheme")}>
          {THEME_PALETTES.map((option) => {
            const tier = paletteUnlockTier(option);
            const title = tier
              ? t(SUPPORTER_TIER_LABEL_KEYS[tier])
              : t("appearanceThemeDefault");
            const unlocked = isPaletteUnlocked(option, unlockedTier);
            return (
              <ListRow
                key={option}
                icon={tier ? undefined : "Palette"}
                leading={
                  tier ? <SupporterBadge kind={tier} size="icon" /> : null
                }
                title={title}
                description={
                  unlocked
                    ? undefined
                    : t("appearanceThemeLocked").replace("{tier}", title)
                }
                selected={palette === option}
                onPress={
                  unlocked
                    ? () => selectPalette(option)
                    : (openDonate ?? undefined)
                }
                chevron={!unlocked && openDonate !== null}
                disabled={!unlocked && openDonate === null}
              />
            );
          })}
        </Section>
      )}
    </Stack>
  );
}
