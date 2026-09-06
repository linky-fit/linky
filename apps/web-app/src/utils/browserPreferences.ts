import type { DisplayCurrency } from "./displayAmounts";

import type { Lang } from "../i18n";

const getPrimaryBrowserLanguage = (): string => {
  if (typeof navigator === "undefined") return "";

  const preferredLanguages = Array.isArray(navigator.languages)
    ? navigator.languages
    : [];

  for (const language of preferredLanguages) {
    const normalized = String(language ?? "")
      .trim()
      .toLowerCase();
    if (normalized) return normalized;
  }

  return navigator.language.trim().toLowerCase();
};

export const getDefaultLang = (): Lang => {
  const language = getPrimaryBrowserLanguage();
  if (language.startsWith("cs")) return "cs";
  if (language.startsWith("de")) return "de";
  return "en";
};

export const getDefaultDisplayCurrency = (): DisplayCurrency => {
  const language = getPrimaryBrowserLanguage();

  if (language.startsWith("cs")) return "czk";
  if (language.startsWith("en")) return "usd";
  return "sat";
};

export const getDefaultAllowedDisplayCurrencies = (): DisplayCurrency[] => {
  const defaultCurrency = getDefaultDisplayCurrency();
  return defaultCurrency === "sat" ? ["sat"] : [defaultCurrency, "sat"];
};
