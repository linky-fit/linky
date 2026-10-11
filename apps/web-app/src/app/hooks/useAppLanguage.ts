import { useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import type { Lang } from "../../i18n";
import { displayPrefsAtom } from "../state/shell/displayPrefs";
import { useTranslation } from "./shell";

/** The UI language with its setter; the language is set on the document. */
export const useAppLanguage = () => {
  const { lang, t } = useTranslation();
  const setPrefs = useAtomSet(displayPrefsAtom);
  const setLang = React.useCallback(
    (next: Lang) => setPrefs((prefs) => ({ ...prefs, lang: next })),
    [setPrefs],
  );

  React.useEffect(() => {
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
