import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import type { CzkAmount } from "./domain";

const LOCALE = "cs-CZ";

/** The amount without its currency, e.g. "1 250,50"; whole crowns drop the haléře. */
export const formatCzkValue = (amount: CzkAmount): string =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);

/** A whole number with grouping, e.g. sats "21 000" or a rate "2 512 346". */
export const formatWhole = (value: number): string =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);

export const formatTime = (sec: number): string =>
  new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(sec * 1000);

/** A history day, e.g. "pondělí 6. října". */
export const formatDay = (sec: number): string =>
  new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(sec * 1000);

export const formatDateTime = (sec: number): string =>
  new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(sec * 1000);

/** A Nostr key someone has no name for, e.g. "npub1abcd…wxyz". */
export const shortNpub = (pubkey: Pubkey): string => {
  const npub = encodeNpub(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
};

/** An invoice or a key is too long to read; its ends identify it. */
export const shorten = (text: string, max = 32): string =>
  text.length > max ? `${text.slice(0, 14)}…${text.slice(-8)}` : text;
