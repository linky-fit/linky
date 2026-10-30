import type { KeypadKey } from "@linky-fit/ui";

const LOCALE = "cs-CZ";

/** The rate the seeded history was priced at; a live payment uses the fetched one. */
export const SEED_CZK_PER_BTC = 2_000_000;

const SATS_PER_BTC = 100_000_000;

/** The most one payment can ask for: 1 000 000 Kč, in haléře. */
const MAX_HALERE = 100_000_000;

/** Whole crowns, then "," and up to two haléře digits, like the app's keypad. */
export const pressKey = (input: string, key: KeypadKey): string => {
  if (key === "C") return "";
  if (key === "⌫") return input.slice(0, -1);
  if (key === ".") return input.includes(",") ? input : `${input || "0"},`;
  const fraction = input.split(",")[1];
  if (fraction !== undefined && fraction.length >= 2) return input;
  const next = input === "0" ? key : `${input}${key}`;
  return typedHalere(next) <= MAX_HALERE ? next : input;
};

/** The typed amount in haléře, e.g. "12,5" is 1250. */
export const typedHalere = (input: string): number => {
  const [whole = "", fraction = ""] = input.split(",");
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
};

/** The typed amount as typed, a trailing comma included, e.g. "1 250,5". */
export const formatTyped = (input: string): string => {
  const [whole = "", fraction] = input.split(",");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
};

/** Crowns without the currency, e.g. "1 250" or "89,50". */
export const formatCrowns = (halere: number): string =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: halere % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(halere / 100);

/** A whole number with Czech grouping, e.g. sats "21 000". */
export const formatWhole = (value: number): string =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);

export const formatTime = (date: Date): string =>
  new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

export const formatDateTime = (date: Date): string =>
  new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

/** A history day, e.g. "pondělí 6. října". */
export const formatDay = (date: Date): string =>
  new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);

/** Rounds up, so the merchant never receives less than the CZK amount. */
export const halereToSats = (
  halere: number,
  czkPerBtc: number = SEED_CZK_PER_BTC,
): number => Math.ceil((halere * SATS_PER_BTC) / (czkPerBtc * 100));

export const satsToHalere = (
  sats: number,
  czkPerBtc: number = SEED_CZK_PER_BTC,
): number => Math.round((sats * czkPerBtc * 100) / SATS_PER_BTC);

/** What the customer chose on the tip step. */
export type TipChoice =
  | { readonly kind: "percent"; readonly percent: number }
  | { readonly kind: "fixed"; readonly tipHalere: number }
  | { readonly kind: "none" };

/** The tiles of the tip step, in order; the custom tip and "no tip" follow them. */
export const TIP_PRESETS: readonly TipChoice[] = [
  { kind: "percent", percent: 5 },
  { kind: "percent", percent: 10 },
  { kind: "percent", percent: 15 },
  { kind: "percent", percent: 20 },
  { kind: "fixed", tipHalere: 2_000 },
  { kind: "fixed", tipHalere: 5_000 },
];

/** The total a tip charges on `base`, and the tip itself (`null` without one); percentages round to whole haléře. */
export const withTip = (
  base: number,
  choice: TipChoice,
): { readonly totalHalere: number; readonly tipHalere: number | null } => {
  const tip =
    choice.kind === "percent"
      ? Math.round((base * choice.percent) / 100)
      : choice.kind === "fixed"
        ? choice.tipHalere
        : 0;
  return { totalHalere: base + tip, tipHalere: tip > 0 ? tip : null };
};
