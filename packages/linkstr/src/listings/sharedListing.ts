import { Option, Schema } from "effect";
import { Pubkey } from "../domain/primitives";
import { encodeNpub } from "../identity/codec";
import { LISTING_SAT_CURRENCY, Listing, listingPriceKind } from "./domain";

/** A listing with its author, as a chat message carries a copy of it. */
export class SharedListing extends Schema.Class<SharedListing>("SharedListing")(
  { author: Pubkey, listing: Listing },
) {}

/** What a text message carrying a shared listing holds: the sender's note, possibly empty, and the copy. */
export interface SharedListingMessage {
  readonly note: string;
  readonly shared: SharedListing;
}

export const SHARED_LISTING_MARKER_PREFIX = "linky:listing:v1:";

const SharedListingMarker = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(SharedListing)),
);
const encodeMarker = Schema.encodeSync(SharedListingMarker);
const decodeMarker = Schema.decodeUnknownOption(SharedListingMarker);

const authorLine = (author: Pubkey): string => `nostr:${encodeNpub(author)}`;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const priceText = (listing: Listing): string => {
  const kind = listingPriceKind(listing);
  if (kind === "free") return "free";
  if (kind === "by-agreement") return "price by agreement";
  return `${listing.amount} ${listing.currency === LISTING_SAT_CURRENCY ? "sat" : listing.currency}`;
};

/** `Eggs · 90 CZK per 10 pieces`: the listing for a reader that does not decode the marker. */
const summaryLine = (listing: Listing): string =>
  `${oneLine(listing.title)} · ${priceText(listing)} ${oneLine(listing.unit)}`;

/** The content of the kind 14 text that shares `shared`, under the sender's `note`. */
export const sharedListingMessageText = (
  shared: SharedListing,
  note: string,
): string => {
  const block = [
    summaryLine(shared.listing),
    authorLine(shared.author),
    `${SHARED_LISTING_MARKER_PREFIX}${encodeMarker(shared)}`,
  ].join("\n");
  const trimmedNote = note.trim();
  return trimmedNote ? `${trimmedNote}\n\n${block}` : block;
};

/** The shared listing a text carries, or null when its last line is not a marker that decodes after the author's line. */
export const parseSharedListingMessage = (
  text: string,
): SharedListingMessage | null => {
  const lines = text.trimEnd().split("\n");
  const marker = lines.at(-1) ?? "";
  if (lines.length < 3 || !marker.startsWith(SHARED_LISTING_MARKER_PREFIX)) {
    return null;
  }
  const shared = Option.getOrNull(
    decodeMarker(marker.slice(SHARED_LISTING_MARKER_PREFIX.length)),
  );
  if (shared === null || lines.at(-2) !== authorLine(shared.author)) {
    return null;
  }
  return { note: lines.slice(0, -3).join("\n").trim(), shared };
};
