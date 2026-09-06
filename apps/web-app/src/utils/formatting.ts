import type { Translate } from "../i18n";
export const getInitials = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) return "?";
  const parts = normalized.split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase());
  return letters.join("") || "?";
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

export const formatShortNpub = (npub: string): string => {
  const trimmed = npub.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 10)}…${trimmed.slice(-6)}`;
};

export const formatShortLightningAddress = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return trimmed.length <= 20 ? trimmed : `${trimmed.slice(0, 10)}...`;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex);
  if (/^npub1/i.test(localPart))
    return `${formatShortNpub(localPart)}${domainPart}`;
  if (localPart.length <= 10) return trimmed;

  return `${localPart.slice(0, 10)}...${domainPart}`;
};

export const formatMiddleDots = (value: string, maxLen: number): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
  if (trimmed.length <= maxLen) return trimmed;
  if (maxLen <= 6) return `${trimmed.slice(0, maxLen)}`;

  const remaining = maxLen - 3;
  const startLen = Math.ceil(remaining / 2);
  const endLen = Math.floor(remaining / 2);
  return `${trimmed.slice(0, startLen)}...${trimmed.slice(-endLen)}`;
};

export const getBestNostrName = (metadata: {
  displayName?: string | undefined;
  name?: string | undefined;
}): string | null => {
  const display = (metadata.displayName ?? "").trim();
  if (display) return display;
  const name = (metadata.name ?? "").trim();
  if (name) return name;
  return null;
};

export const normalizeLocale = (lang?: string): string => {
  const raw = (lang ?? "").trim();
  if (raw) {
    if (raw === "cs") return "cs-CZ";
    if (raw === "de") return "de-DE";
    if (raw === "en") return "en-US";
    return raw;
  }
  if (typeof document !== "undefined") {
    const docLang = (document.documentElement?.lang ?? "").trim();
    if (docLang) {
      if (docLang === "cs") return "cs-CZ";
      if (docLang === "de") return "de-DE";
      return docLang;
    }
  }
  if (typeof navigator !== "undefined") {
    const navLang = navigator.language.trim();
    if (navLang) {
      if (navLang === "cs") return "cs-CZ";
      if (navLang === "de") return "de-DE";
      return navLang;
    }
  }
  return "en-US";
};

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const getDateTimeFormatter = (
  locale: string,
  format: "dayMonth" | "time" | "weekday",
): Intl.DateTimeFormat => {
  const key = `${locale}:${format}`;
  let formatter = dateTimeFormatters.get(key);
  if (formatter) return formatter;

  const options: Intl.DateTimeFormatOptions =
    format === "time"
      ? { hour: "2-digit", minute: "2-digit" }
      : format === "dayMonth"
        ? { day: "2-digit", month: "2-digit" }
        : { weekday: "short" };
  formatter = new Intl.DateTimeFormat(locale, options);
  dateTimeFormatters.set(key, formatter);
  return formatter;
};

export const formatInteger = (value: number, lang?: string): string => {
  const locale = normalizeLocale(lang);
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(
    Number.isFinite(value) ? Math.trunc(value) : Math.trunc(0),
  );
};

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

export const formatRelativeTime = (
  unixSeconds: number,
  lang?: string,
): string => {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const locale = normalizeLocale(lang);
  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(locale, formatter);
  }
  const deltaSeconds = Math.round(unixSeconds - Date.now() / 1000);
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return formatter.format(deltaSeconds, "second");
  if (abs < 3600)
    return formatter.format(Math.trunc(deltaSeconds / 60), "minute");
  if (abs < 86400)
    return formatter.format(Math.trunc(deltaSeconds / 3600), "hour");
  return formatter.format(Math.trunc(deltaSeconds / 86400), "day");
};

export const formatContactMessageTimestamp = (
  createdAtSec: number,
  lang?: string,
): string => {
  const ms = createdAtSec * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const locale = normalizeLocale(lang);
  if (sameDay) {
    return getDateTimeFormatter(locale, "time").format(d);
  }
  return getDateTimeFormatter(locale, "dayMonth").format(d);
};

export const previewTokenText = (token: string | null): string | null => {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed;
};

export const formatChatDayLabel = (
  ms: number,
  lang: string | undefined,
  t: Translate,
): string => {
  const d = new Date(ms);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfThatDay = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();

  const diffDays = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (diffDays === 0) return t("today");
  if (diffDays === 1) return t("yesterday");

  const locale = normalizeLocale(lang);
  const weekday = getDateTimeFormatter(locale, "weekday").format(d);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  if (locale.startsWith("cs")) return `${weekday} ${day}. ${month}.`;
  return `${weekday} ${month}/${day}`;
};
