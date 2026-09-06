export type SiteLocale = "cs" | "de" | "en";

export type SiteDisplayCurrency = "sat" | "btc" | "czk" | "eur" | "chf" | "usd";

export const siteDisplayCurrencies: readonly SiteDisplayCurrency[] = [
  "sat",
  "btc",
  "czk",
  "eur",
  "chf",
  "usd",
];

export const siteLocaleStorageKey = "linky.lang";
export const siteDisplayCurrencyStorageKey = "linky.display_currency.v1";

const getPrimaryBrowserLanguage = (): string => {
  if (typeof navigator === "undefined") return "";

  const preferredLanguages = Array.isArray(navigator.languages)
    ? navigator.languages
    : [];

  for (const language of preferredLanguages) {
    const normalized = language.trim().toLowerCase();
    if (normalized) return normalized;
  }

  return navigator.language.trim().toLowerCase();
};

const isSiteLocale = (value: string | null): value is SiteLocale => {
  return value === "cs" || value === "de" || value === "en";
};

export const getDefaultSiteLocale = (): SiteLocale => {
  const language = getPrimaryBrowserLanguage();

  if (language.startsWith("cs")) return "cs";
  if (language.startsWith("de")) return "de";
  return "en";
};

export const getInitialSiteLocale = (): SiteLocale => {
  if (typeof window === "undefined") return getDefaultSiteLocale();
  const savedLocale = window.localStorage.getItem(siteLocaleStorageKey);
  return isSiteLocale(savedLocale) ? savedLocale : getDefaultSiteLocale();
};

const getDefaultSiteDisplayCurrency = (): SiteDisplayCurrency => {
  const language = getPrimaryBrowserLanguage();

  if (language.startsWith("cs")) return "czk";
  if (language.startsWith("de")) return "eur";
  if (language.startsWith("en")) return "usd";
  return "sat";
};

export const parseSiteDisplayCurrency = (
  value: string | null | undefined,
): SiteDisplayCurrency => {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized === "btc" || normalized === "b") return "btc";
  if (normalized === "czk") return "czk";
  if (normalized === "eur") return "eur";
  if (normalized === "chf") return "chf";
  if (normalized === "usd") return "usd";
  return "sat";
};

export const getInitialSiteDisplayCurrency = (): SiteDisplayCurrency => {
  if (typeof window === "undefined") return getDefaultSiteDisplayCurrency();
  return parseSiteDisplayCurrency(
    window.localStorage.getItem(siteDisplayCurrencyStorageKey) ??
      getDefaultSiteDisplayCurrency(),
  );
};
