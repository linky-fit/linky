import { Stack, ListRow } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useSetLang } from "../app/hooks/settings/useDeviceSettings";
import type { Lang } from "../i18n";

const LANGUAGES: ReadonlyArray<{
  key: "czech" | "german" | "english" | "portuguese";
  value: Lang;
}> = [
  { key: "czech", value: "cs" },
  { key: "german", value: "de" },
  { key: "english", value: "en" },
  { key: "portuguese", value: "pt" },
];

export function LanguagePage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const setLang = useSetLang();

  return (
    <Stack>
      {LANGUAGES.map((language) => (
        <ListRow
          key={language.value}
          title={t(language.key)}
          selected={lang === language.value}
          onPress={() => setLang(language.value)}
          chevron={false}
        />
      ))}
    </Stack>
  );
}
