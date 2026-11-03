import {
  LISTING_SAT_CURRENCY,
  Listing,
  ListingsDocument,
  type CashIntent,
  type ListingSide,
  type Pubkey,
} from "@linky-fit/linkstr";
import type { ListingRecord } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import {
  convertFiatToSat,
  formatDisplayAmountText,
  getDisplayUnitLabel,
  isFiatDisplayCurrency,
  parseDisplayCurrency,
  type DisplayAmountOptions,
  type DisplayCurrency,
} from "../../utils/displayAmounts";
import type { BeaconTrade } from "./beaconSettings";

export const LISTING_SIDES = [
  "offer",
  "want",
] as const satisfies ReadonlyArray<ListingSide>;

const decodeListing = Schema.decodeUnknownOption(Listing);

/** The wire listing of a stored row, or null while the row holds something the wire does not accept. */
export const listingOfRecord = (record: ListingRecord): Listing | null =>
  Option.getOrNull(
    decodeListing({
      id: record.id,
      side: record.side,
      title: record.title,
      amount: record.amount,
      currency: record.currency,
      unit: record.unit,
    }),
  );

/** The document to publish: every valid stored listing, oldest first, plus the cash intent. */
export const buildListingsDocument = (
  records: ReadonlyArray<ListingRecord>,
  cash: CashIntent | null,
): ListingsDocument =>
  new ListingsDocument({
    cash,
    listings: [...records]
      .sort((left, right) => left.createdAtSec - right.createdAtSec)
      .flatMap((record) => {
        const listing = listingOfRecord(record);
        return listing === null ? [] : [listing];
      }),
  });

/** What a publish depends on, as text: equal text means the relays already hold it. */
export const listingsPublishFingerprint = (
  document: ListingsDocument,
  recipients: ReadonlyArray<Pubkey>,
): string =>
  JSON.stringify({
    document: Schema.encodeSync(ListingsDocument)(document),
    recipients: [...recipients].sort(),
  });

/** Offering cash means buying bitcoin for it; wanting cash means selling. */
export const beaconTradeOfCashIntent = (
  cash: CashIntent | null,
): BeaconTrade =>
  cash === "offer" ? "buy" : cash === "want" ? "sell" : "none";

/** A listing is priced in the display currency; a bitcoin or hidden display prices it in sats. */
export const listingCurrencyOfDisplay = (
  displayCurrency: DisplayCurrency,
): string =>
  isFiatDisplayCurrency(displayCurrency)
    ? displayCurrency.toUpperCase()
    : LISTING_SAT_CURRENCY;

/** `Kč`, `EUR`, `sat`: what the amount field shows next to the typed price. */
export const listingCurrencyLabel = (
  currency: string,
  lang: string,
): string => {
  if (currency === LISTING_SAT_CURRENCY)
    return getDisplayUnitLabel("sat", lang);
  const display = parseDisplayCurrency(currency);
  return display !== null && isFiatDisplayCurrency(display)
    ? getDisplayUnitLabel(display, lang)
    : currency;
};

/** A typed amount normalized for the wire; null when it is not a price. Sats are whole. */
export const normalizeListingAmount = (
  input: string,
  currency: string,
): string | null => {
  const text = input.trim().replace(",", ".").replace(/\s+/g, "");
  const pattern =
    currency === LISTING_SAT_CURRENCY ? /^\d{1,12}$/ : /^\d{1,12}(\.\d{1,2})?$/;
  if (!pattern.test(text)) return null;
  if (Number(text) <= 0) return null;
  return text;
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

/** The currencies a listing can be priced in on this device: every allowed display currency, sats once, plus `current` when it is not among them. */
export const listingCurrencyChoices = (
  allowed: ReadonlyArray<DisplayCurrency>,
  current: string,
): ReadonlyArray<string> => {
  const choices = new Set<string>([current]);
  for (const currency of allowed) {
    if (currency !== "hidden") choices.add(listingCurrencyOfDisplay(currency));
  }
  return [...choices];
};

/**
 * The price in the viewer's display unit: exact when the listing is priced in
 * it, otherwise converted at the current rates and marked `~`; without rates
 * for the listing's currency it stays as the author priced it.
 */
export const formatListingPrice = (
  amount: string,
  currency: string,
  options: DisplayAmountOptions,
): string => {
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
