import { createContext, useContext } from "react";
import { copy } from "./copy";
import type { SiteCopy } from "./copy";
import type { SiteLocale } from "./sitePreferences";

export interface LocaleState {
  readonly locale: SiteLocale;
  readonly setLocale: (locale: SiteLocale) => void;
}

export const LocaleContext = createContext<LocaleState | undefined>(undefined);

export const useLocale = (): LocaleState => {
  const state = useContext(LocaleContext);
  if (!state) throw new Error("useLocale needs a LocaleProvider");
  return state;
};

/** The site's strings in the chosen language. */
export const useCopy = (): SiteCopy => copy[useLocale().locale];
