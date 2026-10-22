import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";

const LOCALE = "en-GB";

/** A whole number with space grouping, e.g. "250 000". */
export const formatNumber = (value: number): string =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
    .format(value)
    .replace(/,/gu, " ");

/** Sats with grouping, e.g. "250 000 sat". */
export const formatSats = (sats: number): string => `${formatNumber(sats)} sat`;

/** A "2026-10" month key as "Oct 2026". */
export const formatMonth = (month: string): string => {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(year, monthNumber - 1, 15));
};

export const formatDateTime = (sec: number): string =>
  new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(sec * 1000);

export const formatTime = (sec: number): string =>
  new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(sec * 1000);

/** A user's key, e.g. "npub1abcd…wxyz". */
export const shortNpub = (pubkey: Pubkey): string => {
  const npub = encodeNpub(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
};

/** A txid or an address is too long to read; its ends identify it. */
export const shorten = (text: string, max = 32): string =>
  text.length > max ? `${text.slice(0, 14)}…${text.slice(-8)}` : text;
