import { getDefaultLang } from "../utils/browserPreferences";
import { safeLocalStorageGet, safeLocalStorageSet } from "../utils/storage";
import { cs } from "./cs";
import { de } from "./de";
import { en } from "./en";
import { pt } from "./pt";

export const translations = { cs, de, en, pt } as const;
export type Lang = keyof typeof translations;
export type I18nKey = keyof typeof translations.cs;
export type Translate = (key: I18nKey) => string;

export const isLang = (value: string | null | undefined): value is Lang =>
  typeof value === "string" && Object.hasOwn(translations, value);

const STORAGE_KEY = "linky.lang";

export const getInitialLang = (): Lang => {
  const stored = safeLocalStorageGet(STORAGE_KEY);
  return isLang(stored) ? stored : getDefaultLang();
};

export const persistLang = (lang: Lang) => {
  safeLocalStorageSet(STORAGE_KEY, lang);
};
