export type SiteLocale = "cs" | "en";

export const siteLocales: readonly SiteLocale[] = ["cs", "en"];

/** The same key the app uses, so the site reads like the app on a device that chose. */
export const siteLocaleStorageKey = "linky.fazole.language";

const isSiteLocale = (value: string | null): value is SiteLocale =>
  value === "cs" || value === "en";

/** Czech for a Czech browser, English for any other, like the app. */
export const getDefaultSiteLocale = (): SiteLocale => {
  const language =
    typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  return language.startsWith("cs") ? "cs" : "en";
};

export const getInitialSiteLocale = (): SiteLocale => {
  if (typeof window === "undefined") return getDefaultSiteLocale();
  const saved = window.localStorage.getItem(siteLocaleStorageKey);
  return isSiteLocale(saved) ? saved : getDefaultSiteLocale();
};
