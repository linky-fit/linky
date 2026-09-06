import React from "react";
import {
  getInitialLang,
  persistLang,
  translations,
  type I18nKey,
  type Lang,
} from "../../i18n";

export const useAppLanguage = () => {
  const [lang, setLang] = React.useState<Lang>(() => getInitialLang());
  const t = React.useCallback(
    (key: I18nKey) => translations[lang][key],
    [lang],
  );

  React.useEffect(() => {
    persistLang(lang);
    try {
      document.documentElement.lang = lang;
      document.documentElement.setAttribute("translate", "no");
      document.documentElement.classList.add("notranslate");
    } catch {
      // ignore
    }
  }, [lang]);

  return { lang, setLang, t };
};
