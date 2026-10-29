import { normalizeProfileName } from "./profileName";
import type { Translate } from "../i18n";
import { nowSeconds } from "./time";

export const firstName = (name: string): string =>
  name.trim().split(/\s+/)[0] ?? name;

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

/** "bc1q 5089 … f3t4": an address in groups of four, to read along with a wallet. */
export const groupAddress = (address: string): string =>
  address.match(/.{1,4}/gu)?.join(" ") ?? address;

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
  const display = normalizeProfileName(metadata.displayName ?? "");
  if (display) return display;
  const name = normalizeProfileName(metadata.name ?? "");
  if (name) return name;
  return null;
};

export const normalizeLocale = (lang?: string): string => {
  const raw = (lang ?? "").trim();
  if (raw) {
    if (raw === "cs") return "cs-CZ";
    if (raw === "de") return "de-DE";
    if (raw === "pt") return "pt-BR";
    if (raw === "en") return "en-US";
    return raw;
  }
  if (typeof document !== "undefined") {
    const docLang = (document.documentElement?.lang ?? "").trim();
    if (docLang) {
      if (docLang === "cs") return "cs-CZ";
      if (docLang === "de") return "de-DE";
      if (docLang === "pt") return "pt-BR";
      return docLang;
    }
  }
  if (typeof navigator !== "undefined") {
    const navLang = navigator.language.trim();
    if (navLang) {
      if (navLang === "cs") return "cs-CZ";
      if (navLang === "de") return "de-DE";
      if (navLang === "pt") return "pt-BR";
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
const pastDateFormatters = new Map<string, Intl.DateTimeFormat>();

const getRelativeTimeFormatter = (locale: string): Intl.RelativeTimeFormat => {
  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
      style: "narrow",
    });
    relativeTimeFormatters.set(locale, formatter);
  }
  return formatter;
};

const getPastDateFormatter = (locale: string): Intl.DateTimeFormat => {
  let formatter = pastDateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    pastDateFormatters.set(locale, formatter);
  }
  return formatter;
};

const MINUTE_SEC = 60;
const HOUR_SEC = 60 * MINUTE_SEC;
const DAY_SEC = 24 * HOUR_SEC;
const RELATIVE_LIMIT_SEC = 7 * DAY_SEC;

/** "now", "5m ago", "2h ago", "yesterday", "3d ago", then a plain date. */
export const formatTimeAgo = (unixSeconds: number, lang?: string): string => {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const locale = normalizeLocale(lang);
  // Clock skew can put a timestamp slightly in the future; show it as "now".
  const ageSec = Math.max(0, nowSeconds() - unixSeconds);
  if (ageSec >= RELATIVE_LIMIT_SEC) {
    return getPastDateFormatter(locale).format(new Date(unixSeconds * 1000));
  }
  const formatter = getRelativeTimeFormatter(locale);
  if (ageSec < MINUTE_SEC) return formatter.format(0, "second");
  if (ageSec < HOUR_SEC)
    return formatter.format(-Math.floor(ageSec / MINUTE_SEC), "minute");
  if (ageSec < DAY_SEC)
    return formatter.format(-Math.floor(ageSec / HOUR_SEC), "hour");
  return formatter.format(-Math.floor(ageSec / DAY_SEC), "day");
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
