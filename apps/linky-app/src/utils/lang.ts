import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { getDefaultLang } from "./browserPreferences";

export const LANGS = ["cs", "de", "en", "pt"] as const;
export type Lang = (typeof LANGS)[number];

export const isLang = (value: string | null | undefined): value is Lang =>
  LANGS.some((lang) => lang === value);

const LANG_STORAGE_KEY = "linky.lang";

export const readStoredLang = (kv: KeyValueStorage): Lang => {
  const stored = kv.getItem(LANG_STORAGE_KEY);
  return isLang(stored) ? stored : getDefaultLang();
};

export const storeLang = (kv: KeyValueStorage, lang: Lang): void =>
  kv.setItem(LANG_STORAGE_KEY, lang);
