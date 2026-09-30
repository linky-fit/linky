import { getDefaultLang } from "../utils/browserPreferences";
import { safeLocalStorageGet, safeLocalStorageSet } from "../utils/storage";
import { cs } from "./cs";
import { de } from "./de";
import { en } from "./en";

export const translations = { cs, de, en } as const;
export type Lang = keyof typeof translations;
export type I18nKey = keyof typeof translations.cs;
export type Translate = (key: I18nKey) => string;

const STORAGE_KEY = "linky.lang";

export const getInitialLang = (): Lang => {
  const stored = safeLocalStorageGet(STORAGE_KEY);
  if (stored === "cs" || stored === "de" || stored === "en") return stored;
  return getDefaultLang();
};

export const persistLang = (lang: Lang) => {
  safeLocalStorageSet(STORAGE_KEY, lang);
};
