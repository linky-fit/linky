import { ListRow, Section } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useSetLang } from "../app/hooks/settings/useDeviceSettings";
import type { I18nKey, Lang } from "../i18n";

export const LANGUAGE_LABEL_KEYS = {
  cs: "czech",
  de: "german",
  en: "english",
  pt: "portuguese",
  sk: "slovak",
} as const satisfies Record<Lang, I18nKey>;

const LANGUAGES: ReadonlyArray<{
  key: (typeof LANGUAGE_LABEL_KEYS)[Lang];
  value: Lang;
}> = [
  { key: "czech", value: "cs" },
  { key: "german", value: "de" },
  { key: "english", value: "en" },
  { key: "portuguese", value: "pt" },
  { key: "slovak", value: "sk" },
];

export function LanguagePage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const setLang = useSetLang();

  return (
    <Section grouped>
      {LANGUAGES.map((language) => (
        <ListRow
          key={language.value}
          title={t(language.key)}
          selected={lang === language.value}
          onPress={() => setLang(language.value)}
          chevron={false}
        />
      ))}
    </Section>
  );
}
