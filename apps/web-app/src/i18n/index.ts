import { isLang, readStoredLang, type Lang } from "../utils/lang";
import { localStorageKv } from "../utils/storage";
import { cs } from "./cs";
import { de } from "./de";
import { en } from "./en";
import { pt } from "./pt";

export const translations = { cs, de, en, pt } as const satisfies Record<
  Lang,
  unknown
>;
export type { Lang };
export type I18nKey = keyof typeof translations.cs;
export type Translate = (key: I18nKey) => string;

export { isLang };

export const getInitialLang = (): Lang => readStoredLang(localStorageKv);
