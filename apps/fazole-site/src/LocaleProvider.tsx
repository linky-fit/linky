import type { ReactNode } from "react";
import { LocaleContext } from "./locale";
import type { SiteLocale } from "./sitePreferences";

export function LocaleProvider({
  locale,
  onLocaleChange,
  children,
}: {
  locale: SiteLocale;
  onLocaleChange: (locale: SiteLocale) => void;
  children: ReactNode;
}) {
  return (
    <LocaleContext value={{ locale, setLocale: onLocaleChange }}>
      {children}
    </LocaleContext>
  );
}
