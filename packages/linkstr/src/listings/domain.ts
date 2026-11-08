import { Effect, Schema } from "effect";
import { PrivateImage } from "../chat/domain";
import { Pubkey } from "../domain/primitives";

/** How far a listing may travel: `network` lets its readers pass it on to their own contacts, once. */
export const ListingReach = Schema.Literal("network");
export type ListingReach = typeof ListingReach.Type;

/** Whether the author offers the listing or looks for it. */
export const ListingSide = Schema.Literals(["offer", "want"]);
export type ListingSide = typeof ListingSide.Type;

export const LISTING_UNIT_MAX_LENGTH = 40;

/** What the price buys, in the author's words ("per hour", "per kg"); shown as written. */
export const ListingUnit = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(LISTING_UNIT_MAX_LENGTH),
);
export type ListingUnit = typeof ListingUnit.Type;

/** The author has cash and wants bitcoin for it, or the other way round. */
export const CashIntent = Schema.Literals(["offer", "want"]);
export type CashIntent = typeof CashIntent.Type;

/** A decimal amount as the author typed it, so no client re-rounds it. */
export const ListingAmount = Schema.String.check(
  Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/),
).pipe(Schema.brand("ListingAmount"));
export type ListingAmount = typeof ListingAmount.Type;

/** The code for satoshis, next to ISO 4217 codes; an amount in it is whole sats. */
export const LISTING_SAT_CURRENCY = "SAT";

/** An ISO 4217 code, or `SAT`; the amount is in this currency. */
export const ListingCurrency = Schema.String.check(
  Schema.isPattern(/^[A-Z]{3}$/),
).pipe(Schema.brand("ListingCurrency"));
export type ListingCurrency = typeof ListingCurrency.Type;

export const LISTING_TITLE_MAX_LENGTH = 120;

export const LISTING_DESCRIPTION_MAX_LENGTH = 500;

/** More about the listing in the author's words; line breaks are kept. */
export const ListingDescription = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(LISTING_DESCRIPTION_MAX_LENGTH),
);
export type ListingDescription = typeof ListingDescription.Type;

/** One thing the author offers or wants; `id` is the author's own stable key for it. */
export class Listing extends Schema.Class<Listing>("Listing")({
  id: Schema.Trimmed.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  side: ListingSide,
  title: Schema.Trimmed.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(LISTING_TITLE_MAX_LENGTH),
  ),
  amount: ListingAmount,
  currency: ListingCurrency,
  unit: ListingUnit,
  /** The author left the price to be agreed; it counts only with a zero `amount`, which releases that do not know this field show instead. */
  priceByAgreement: Schema.optionalKey(Schema.Literal(true)),
  /** A malformed or too long description decodes as none, so it never costs the listing or the document. */
  description: Schema.optionalKey(
    ListingDescription.pipe(Schema.catchDecoding(() => Effect.succeedNone)),
  ),
  /** A malformed image decodes as none, so it never costs the listing or the document. */
  image: Schema.optionalKey(
    PrivateImage.pipe(Schema.catchDecoding(() => Effect.succeedNone)),
  ),
  /** `network`: the readers may pass the listing on to their own contacts; any other value decodes as none. */
  audience: Schema.optionalKey(
    ListingReach.pipe(Schema.catchDecoding(() => Effect.succeedNone)),
  ),
}) {}

/** What a listing asks for: its `amount`, nothing, or a price the two parties agree on. */
export type ListingPriceKind = "amount" | "free" | "by-agreement";

export const listingPriceKind = ({
  amount,
  priceByAgreement,
}: Pick<Listing, "amount" | "priceByAgreement">): ListingPriceKind =>
  Number(amount) > 0
    ? "amount"
    : priceByAgreement === true
      ? "by-agreement"
      : "free";

/** A listing with its author, as a chat message or a passed-on listing carries a copy of it. */
export class SharedListing extends Schema.Class<SharedListing>("SharedListing")(
  { author: Pubkey, listing: Listing },
) {}

/** Everything one author shares with the contacts that can read it; the newest replaces the whole document. */
export class ListingsDocument extends Schema.Class<ListingsDocument>(
  "ListingsDocument",
)({
  cash: Schema.NullOr(CashIntent).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(null)),
    Schema.withConstructorDefault(Effect.succeed(null)),
  ),
  listings: Schema.Array(Listing).pipe(
    Schema.withDecodingDefaultType(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  /**
   * Contacts' `network` listings the author passes on to their own contacts,
   * each with its original author; never passed on again. A malformed list
   * decodes as empty, so it never costs the document.
   */
  passedOn: Schema.optionalKey(
    Schema.Array(SharedListing).pipe(
      Schema.catchDecoding(() => Effect.succeedNone),
    ),
  ),
}) {}

/** A document with no cash intent and no listings, which is what an author publishes to withdraw everything. */
export const emptyListingsDocument = new ListingsDocument({});

export const isEmptyListingsDocument = (document: ListingsDocument): boolean =>
  document.cash === null &&
  document.listings.length === 0 &&
  (document.passedOn ?? []).length === 0;

/** Listings only some of the recipients may read, on top of the document. */
export class ListingsAudience extends Schema.Class<ListingsAudience>(
  "ListingsAudience",
)({
  listings: Schema.Array(Listing),
  /** Who reads these listings; a pubkey missing from the draft's `recipients` reads nothing. */
  recipients: Schema.Array(Pubkey),
}) {}

export class ListingsDraft extends Schema.Class<ListingsDraft>("ListingsDraft")(
  {
    document: ListingsDocument,
    /** The contacts given a key slot; nobody else can read the content. The author needs no slot. */
    recipients: Schema.Array(Pubkey),
    /** Listings for some recipients only, such as a group of contacts; each reader gets the document's listings followed by those of their audiences. */
    audiences: Schema.Array(ListingsAudience).pipe(
      Schema.withDecodingDefaultType(Effect.succeed([])),
      Schema.withConstructorDefault(Effect.succeed([])),
    ),
  },
) {}
