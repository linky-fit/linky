import { getDefaultLang } from "../utils/browserPreferences";
import { cs } from "./cs";
import { de } from "./de";
import { en } from "./en";

export const translations = { cs, de, en } as const;
export type Lang = keyof typeof translations;
export type I18nKey = keyof typeof translations.cs;
export type Translate = (key: I18nKey) => string;

const STORAGE_KEY = "linky.lang";

export const getInitialLang = (): Lang => {
  if (typeof localStorage === "undefined") return getDefaultLang();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "cs" || stored === "de" || stored === "en") return stored;
  return getDefaultLang();
};

export const persistLang = (lang: Lang) => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
};
