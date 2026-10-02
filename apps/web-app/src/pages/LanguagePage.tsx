import { Stack, ListRow } from "@linky-fit/ui";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
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
  const { lang, t } = useAppShellCore();
  const { setLang } = useAppShellActions();

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
