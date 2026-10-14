import { heldWorkSettled } from "./pwaUpdate";
import { localStorageKv } from "./storage";

export const LANGUAGES = ["cs", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  cs: "Čeština",
  en: "English",
};

const LANGUAGE_KEY = "linky.fazole.language";

/** The merchant's choice, otherwise Czech on a Czech device and English on any other. */
export const resolveLanguage = (
  stored: string | null,
  deviceLanguage: string,
): Language => {
  const chosen = LANGUAGES.find((known) => known === stored);
  if (chosen !== undefined) return chosen;
  return deviceLanguage.toLowerCase().startsWith("cs") ? "cs" : "en";
};

export const language = resolveLanguage(
  localStorageKv.getItem(LANGUAGE_KEY),
  navigator.language,
);

export const locale = language === "cs" ? "cs-CZ" : "en";

/** Keeps the choice and reloads into it once wallet work settles, as an update does. */
export const switchLanguage = async (next: Language) => {
  localStorageKv.setItem(LANGUAGE_KEY, next);
  await heldWorkSettled();
  location.reload();
};
