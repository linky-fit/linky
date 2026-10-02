import { useEffect, useState } from "react";
import {
  getInitialSiteLocale,
  siteLocaleStorageKey,
  type SiteLocale,
} from "./sitePreferences";

export const useSiteLocale = () => {
  const [locale, setLocale] = useState<SiteLocale>(getInitialSiteLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(siteLocaleStorageKey, locale);
  }, [locale]);

  return [locale, setLocale] as const;
};
