import {
  LISTING_SAT_CURRENCY,
  Listing,
  listingPriceKind,
  ListingsDraft,
  PrivateImage,
  type CashIntent,
  type ListingSide,
  type RelayUrl,
} from "@linky-fit/linkstr";
import type { ListingRecord } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import {
  DISPLAY_CURRENCIES,
  convertFiatToSat,
  formatDisplayAmountText,
  getDisplayUnitLabel,
  isFiatDisplayCurrency,
  parseDisplayCurrency,
  type DisplayAmountOptions,
  type DisplayCurrency,
} from "../../utils/displayAmounts";
import type { Translate } from "../../i18n";
import type { BeaconTrade } from "./beaconSettings";

export const LISTING_SIDES = [
  "offer",
  "want",
] as const satisfies ReadonlyArray<ListingSide>;

const decodeListing = Schema.decodeUnknownOption(Listing);
const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
);

/** The `image` column of a listing row. */
export const encodeListingImage = Schema.encodeSync(
  Schema.fromJsonString(PrivateImage),
);

/** The wire listing of a stored row, or null while the row holds something the wire does not accept; a description or image that does not decode is left out. */
export const listingOfRecord = (record: ListingRecord): Listing | null => {
  const image =
    record.image === null ? Option.none() : decodeJson(record.image);
  return Option.getOrNull(
    decodeListing({
      id: record.id,
      side: record.side,
      title: record.title,
      amount: record.amount,
      currency: record.currency,
      unit: record.unit,
      ...(record.priceByAgreement === 1 ? { priceByAgreement: true } : {}),
      ...(record.description === null
        ? {}
        : { description: record.description }),
      ...(Option.isSome(image) ? { image: image.value } : {}),
    }),
  );
};

export interface ListingsPublication {
  readonly draft: ListingsDraft;
  readonly relays: ReadonlyArray<RelayUrl>;
  /** Changes on a schedule, so relays that dropped the events get them again. */
  readonly refreshPeriod: number;
}

/** What a publish depends on, as text: equal text means the relays already hold it. */
export const listingsPublishFingerprint = ({
  draft,
  relays,
  refreshPeriod,
}: ListingsPublication): string =>
  JSON.stringify({
    draft: Schema.encodeSync(ListingsDraft)(
      new ListingsDraft({
        ...draft,
        recipients: [...draft.recipients].sort(),
      }),
    ),
    relays: [...relays].sort(),
    refreshPeriod,
  });

/** Offering cash means buying bitcoin for it; wanting cash means selling. */
export const beaconTradeOfCashIntent = (
  cash: CashIntent | null,
): BeaconTrade =>
  cash === "offer" ? "buy" : cash === "want" ? "sell" : "none";

/** `BTC` is a form-only unit: the wire prices bitcoin in whole sats. */
export const LISTING_BTC_UNIT = "BTC";

const SATS_PER_BTC = 100_000_000;
const BTC_FRACTION_DIGITS = 8;

/** The price unit a display currency types in: `SAT`, `BTC` or the ISO code; a hidden display has none. */
export const listingUnitOfDisplay = (
  displayCurrency: DisplayCurrency,
): string | null => {
  if (displayCurrency === "hidden") return null;
  if (displayCurrency === "btc") return LISTING_BTC_UNIT;
  if (displayCurrency === "sat") return LISTING_SAT_CURRENCY;
  return displayCurrency.toUpperCase();
};

/** The wire currency of a form unit: bitcoin is stored as sats. */
export const listingWireCurrency = (unit: string): string =>
  unit === LISTING_BTC_UNIT ? LISTING_SAT_CURRENCY : unit;

/** The price units the form offers: exactly the display currencies enabled in Settings, in the order the unit toggle cycles them; sats when nothing but a hidden display is on. */
export const listingPriceUnits = (
  allowed: ReadonlyArray<DisplayCurrency>,
): ReadonlyArray<string> => {
  const units = DISPLAY_CURRENCIES.flatMap((currency) => {
    const unit = listingUnitOfDisplay(currency);
    return allowed.includes(currency) && unit !== null ? [unit] : [];
  });
  return units.length > 0 ? units : [LISTING_SAT_CURRENCY];
};

/** The unit a new listing is priced in: the display unit when it is among `units`, else the first of them. */
export const defaultListingUnit = (
  displayCurrency: DisplayCurrency,
  units: ReadonlyArray<string>,
): string => {
  const unit = listingUnitOfDisplay(displayCurrency);
  return unit !== null && units.includes(unit)
    ? unit
    : (units[0] ?? LISTING_SAT_CURRENCY);
};

/** Whole sats as a bitcoin number, e.g. "123456" → "0.00123456", built from digits so no float rounding leaks in. */
const satsToBtcText = (amountSat: string): string => {
  const digits = amountSat.padStart(BTC_FRACTION_DIGITS + 1, "0");
  const whole = digits.slice(0, -BTC_FRACTION_DIGITS);
  const fraction = digits.slice(-BTC_FRACTION_DIGITS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

/** How a stored price opens in the form: a sat price shows in bitcoin when only bitcoin is enabled, anything else stays in its own currency. */
export const listingPriceInput = (
  amount: string,
  currency: string,
  units: ReadonlyArray<string>,
): { amount: string; unit: string } =>
  currency === LISTING_SAT_CURRENCY &&
  !units.includes(LISTING_SAT_CURRENCY) &&
  units.includes(LISTING_BTC_UNIT)
    ? { amount: satsToBtcText(amount), unit: LISTING_BTC_UNIT }
    : { amount, unit: currency };

/** `Kč`, `EUR`, `₿`, `sat`: what the amount field shows next to the typed price. */
export const listingCurrencyLabel = (
  currency: string,
  lang: string,
): string => {
  if (currency === LISTING_SAT_CURRENCY)
    return getDisplayUnitLabel("sat", lang);
  if (currency === LISTING_BTC_UNIT) return getDisplayUnitLabel("btc", lang);
  const display = parseDisplayCurrency(currency);
  return display !== null && isFiatDisplayCurrency(display)
    ? getDisplayUnitLabel(display, lang)
    : currency;
};

/** How many decimals a price in `currency` takes: none for sats, 8 for bitcoin, 2 otherwise. */
export const listingFractionDigits = (currency: string): number =>
  currency === LISTING_SAT_CURRENCY
    ? 0
    : currency === LISTING_BTC_UNIT
      ? BTC_FRACTION_DIGITS
      : 2;

/** The typed price kept numeric: digits and at most one decimal separator, cut where `currency` takes no more decimals. */
export const filterListingAmountInput = (
  input: string,
  currency: string,
): string => {
  const fractionDigits = listingFractionDigits(currency);
  let text = "";
  let fraction: number | null = null;
  for (const char of input) {
    if (/\d/.test(char)) {
      if (fraction === null) text += char;
      else if (fraction < fractionDigits) {
        text += char;
        fraction += 1;
      }
    } else if (char === "." || char === ",") {
      if (fraction !== null || fractionDigits === 0) break;
      text += char;
      fraction = 0;
    }
  }
  return text;
};

/** A typed amount normalized for the wire, zero for a free listing; null when it is not a price. Sats are whole; bitcoin becomes whole sats. */
export const normalizeListingAmount = (
  input: string,
  currency: string,
): string | null => {
  const text = input
    .trim()
    .replace(",", ".")
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
  if (currency === LISTING_BTC_UNIT) {
    const match = /^(\d{1,4})(?:\.(\d{1,8}))?$/.exec(text);
    if (!match) return null;
    const sats =
      Number(match[1]) * SATS_PER_BTC +
      Number((match[2] ?? "").padEnd(BTC_FRACTION_DIGITS, "0"));
    return String(sats);
  }
  const pattern =
    currency === LISTING_SAT_CURRENCY ? /^\d{1,12}$/ : /^\d{1,12}(\.\d{1,2})?$/;
  return pattern.test(text) ? text : null;
};

const numberFormatters = new Map<string, Intl.NumberFormat>();

/** `90 Kč`, `1 800 Kč`, `12,50 EUR`: the amount with the same unit label the rest of the app uses, decimals only when the author typed them. */
const formatInListingCurrency = (
  amount: string,
  currency: string,
  lang: string,
): string => {
  const fractionDigits = amount.includes(".") ? 2 : 0;
  const key = `${lang}:${fractionDigits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(lang, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    numberFormatters.set(key, formatter);
  }
  return `${formatter.format(Number(amount))} ${listingCurrencyLabel(currency, lang)}`;
};

/**
 * The price in the viewer's display unit: exact when the listing is priced in
 * it, otherwise converted at the current rates and marked `~`; without rates
 * for the listing's currency it stays as the author priced it. A listing
 * without a price reads as free or by agreement.
 */
export const formatListingPrice = (
  listing: Pick<Listing, "amount" | "currency" | "priceByAgreement">,
  options: DisplayAmountOptions,
  t: Translate,
): string => {
  const kind = listingPriceKind(listing);
  if (kind === "free") return t("listingPriceFree");
  if (kind === "by-agreement") return t("listingPriceByAgreement");
  const { amount, currency } = listing;
  const listingCurrency =
    currency === LISTING_SAT_CURRENCY ? "sat" : parseDisplayCurrency(currency);
  if (listingCurrency === "sat") {
    return formatDisplayAmountText(Number(amount), options);
  }
  if (listingCurrency === null || !isFiatDisplayCurrency(listingCurrency)) {
    return formatInListingCurrency(amount, currency, options.lang ?? "en");
  }
  if (
    listingCurrency === options.displayCurrency ||
    options.fiatRates === null
  ) {
    return formatInListingCurrency(amount, currency, options.lang ?? "en");
  }
  const amountSat = convertFiatToSat(
    Number(amount),
    listingCurrency,
    options.fiatRates,
  );
  const text = formatDisplayAmountText(amountSat, options);
  return text.startsWith("~") || options.displayCurrency === "hidden"
    ? text
    : `~${text}`;
};
